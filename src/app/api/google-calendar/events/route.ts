import { NextResponse } from "next/server";

import {
  ensureFreshAccessToken,
  listCalendarEvents,
  type GoogleCalendarConnectionRecord
} from "@/lib/google-calendar";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";
import type { CalendarEvent } from "@/lib/types";

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
  const { data: connection, error: connectionError } = await supabase
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (connectionError || !connection) {
    return NextResponse.json(
      { error: connectionError?.message ?? "Google Calendar is not connected." },
      { status: 400 }
    );
  }

  try {
    const origin = new URL(request.url).origin;
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

    const events = await listCalendarEvents(
      refreshed.accessToken,
      connection.calendar_id ?? "primary"
    );

    const normalized: CalendarEvent[] = events.map((event) => ({
      id: event.id,
      summary: event.summary || "Untitled event",
      description: event.description ?? null,
      htmlLink: event.htmlLink ?? null,
      start: event.start?.dateTime ?? event.start?.date ?? null,
      end: event.end?.dateTime ?? event.end?.date ?? null,
      isAllDay: Boolean(event.start?.date && !event.start?.dateTime)
    }));

    return NextResponse.json({ events: normalized });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Calendar event fetch failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
