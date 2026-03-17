import { NextResponse } from "next/server";

import { isGoogleCalendarConfigured } from "@/lib/google-calendar";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const nextRequest = request as unknown as import("next/server").NextRequest;
  const user = await getAuthenticatedUserFromRequest(nextRequest);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isGoogleCalendarConfigured() || !isServerSupabaseConfigured()) {
    return NextResponse.json({
      configured: false,
      connected: false,
      googleEmail: null,
      calendarId: null
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("google_calendar_connections")
    .select("google_email, calendar_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    configured: true,
    connected: Boolean(data),
    googleEmail: data?.google_email ?? null,
    calendarId: data?.calendar_id ?? null
  });
}

