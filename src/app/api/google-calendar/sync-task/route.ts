import { NextResponse } from "next/server";

import {
  buildCalendarEventPayload,
  ensureFreshAccessToken,
  type GoogleCalendarConnectionRecord
} from "@/lib/google-calendar";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";
import type { Task } from "@/lib/types";

async function upsertCalendarEvent(
  accessToken: string,
  eventId: string | null | undefined,
  payload: ReturnType<typeof buildCalendarEventPayload>
) {
  const baseUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

  if (eventId) {
    const updateResponse = await fetch(`${baseUrl}/${eventId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (updateResponse.ok) {
      return updateResponse.json();
    }
  }

  const createResponse = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!createResponse.ok) {
    const body = await createResponse.text();
    throw new Error(`Google Calendar sync failed: ${body}`);
  }

  return createResponse.json();
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

  const { taskId } = (await request.json()) as { taskId?: string };

  if (!taskId) {
    return NextResponse.json({ error: "Task ID is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const [{ data: task, error: taskError }, { data: connection, error: connectionError }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("google_calendar_connections")
        .select("*")
        .eq("user_id", user.id)
        .single()
    ]);

  if (taskError || !task) {
    return NextResponse.json(
      { error: taskError?.message ?? "Task not found." },
      { status: 404 }
    );
  }

  if (connectionError || !connection) {
    return NextResponse.json(
      { error: connectionError?.message ?? "Google Calendar is not connected." },
      { status: 400 }
    );
  }

  if (!(task as Task).due_date) {
    return NextResponse.json(
      { error: "Add a due date before syncing this task to Google Calendar." },
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

    const googleEvent = (await upsertCalendarEvent(
      refreshed.accessToken,
      (task as Task).google_calendar_event_id,
      buildCalendarEventPayload(task as Task)
    )) as {
      htmlLink?: string;
      id?: string;
    };

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({
        google_calendar_event_id: googleEvent.id ?? null,
        google_calendar_event_url: googleEvent.htmlLink ?? null,
        google_calendar_last_synced_at: new Date().toISOString()
      })
      .eq("id", taskId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ task: updatedTask });
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Calendar sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

