import { NextResponse } from "next/server";

import { ensureFreshAccessToken, type GoogleCalendarConnectionRecord } from "@/lib/google-calendar";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";

type CreateEventRequest = {
  title?: string;
  description?: string;
  date?: string;
  allDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
};

function buildManualEventPayload(payload: Required<Pick<CreateEventRequest, "title" | "date">> & {
  description: string | null;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
}) {
  if (payload.allDay) {
    const endDate = new Date(`${payload.date}T00:00:00`);
    endDate.setDate(endDate.getDate() + 1);

    return {
      summary: payload.title,
      description: payload.description,
      start: {
        date: payload.date
      },
      end: {
        date: endDate.toISOString().slice(0, 10)
      }
    };
  }

  if (!payload.startTime || !payload.endTime) {
    throw new Error("Start time and end time are required for timed events.");
  }

  const startDateTime = `${payload.date}T${payload.startTime}:00`;
  const endDateTime = `${payload.date}T${payload.endTime}:00`;

  if (new Date(endDateTime).getTime() <= new Date(startDateTime).getTime()) {
    throw new Error("End time must be after the start time.");
  }

  return {
    summary: payload.title,
    description: payload.description,
    start: {
      dateTime: startDateTime
    },
    end: {
      dateTime: endDateTime
    }
  };
}

export async function POST(request: Request) {
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

  const body = (await request.json()) as CreateEventRequest;
  const title = body.title?.trim();
  const date = body.date?.trim();

  if (!title || !date) {
    return NextResponse.json({ error: "Title and date are required." }, { status: 400 });
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

    const googleResponse = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshed.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(
          buildManualEventPayload({
            title,
            description: body.description?.trim() || null,
            date,
            allDay: Boolean(body.allDay),
            startTime: body.startTime ?? null,
            endTime: body.endTime ?? null
          })
        )
      }
    );

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text();
      throw new Error(`Google Calendar event creation failed: ${errorText}`);
    }

    const event = (await googleResponse.json()) as {
      id?: string;
      htmlLink?: string;
    };

    return NextResponse.json({ event });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Unable to create calendar event.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
