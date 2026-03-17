import { NextResponse } from "next/server";

import { loadFeedEvents } from "@/lib/calendar-feeds";
import {
  ensureFreshAccessToken,
  listCalendarEvents,
  type GoogleCalendarConnectionRecord
} from "@/lib/google-calendar";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";
import type { CalendarEvent, CalendarFeed } from "@/lib/types";

export async function GET(request: Request) {
  const nextRequest = request as unknown as import("next/server").NextRequest;
  const user = await getAuthenticatedUserFromRequest(nextRequest);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isServerSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Server-side Supabase credentials are missing." },
      { status: 500 }
    );
  }

  const supabase = getSupabaseAdminClient();
  const [{ data: connection }, { data: feeds, error: feedsError }] = await Promise.all([
    supabase
      .from("google_calendar_connections")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("calendar_feeds")
      .select("id, name, url, domain")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
  ]);

  if (feedsError) {
    return NextResponse.json({ error: feedsError.message }, { status: 500 });
  }

  try {
    const origin = new URL(request.url).origin;
    const events: CalendarEvent[] = [];

    if (connection) {
      const refreshed = await ensureFreshAccessToken(
        origin,
        connection as GoogleCalendarConnectionRecord
      );

      if (
        refreshed.accessToken !== connection.access_token ||
        refreshed.refreshToken !== connection.refresh_token ||
        refreshed.expiresAt !== connection.expires_at
      ) {
        await supabase
          .from("google_calendar_connections")
          .update({
            access_token: refreshed.accessToken,
            refresh_token: refreshed.refreshToken,
            expires_at: refreshed.expiresAt
          })
          .eq("user_id", user.id);
      }

      const googleEvents = await listCalendarEvents(
        refreshed.accessToken,
        connection.calendar_id ?? "primary"
      );

      events.push(
        ...googleEvents.map((event) => ({
          id: event.id,
          summary: event.summary || "Untitled event",
          description: event.description ?? null,
          htmlLink: event.htmlLink ?? null,
          start: event.start?.dateTime ?? event.start?.date ?? null,
          end: event.end?.dateTime ?? event.end?.date ?? null,
          isAllDay: Boolean(event.start?.date && !event.start?.dateTime),
          source: "google" as const,
          sourceName: connection.google_email ?? "Google Calendar",
          domain:
            event.extendedProperties?.private?.focusDeskDomain ??
            connection.default_domain ??
            "personal"
        }))
      );
    }

    if (feeds?.length) {
      const feedEvents = await Promise.all(
        (feeds as CalendarFeed[]).map(async (feed) => {
          try {
            return await loadFeedEvents(feed);
          } catch {
            return [];
          }
        })
      );

      events.push(...feedEvents.flat());
    }

    events.sort((left, right) => {
      if (!left.start || !right.start) {
        return 0;
      }

      return new Date(left.start).getTime() - new Date(right.start).getTime();
    });

    return NextResponse.json({ events: events.slice(0, 60) });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Calendar event fetch failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
