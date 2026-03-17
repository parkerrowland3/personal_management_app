import { NextResponse } from "next/server";

import { isGoogleCalendarConfigured } from "@/lib/google-calendar";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";
import { DOMAIN_OPTIONS, type Domain } from "@/lib/types";

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
      calendarId: null,
      defaultDomain: null
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("google_calendar_connections")
    .select("google_email, calendar_id, default_domain")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    configured: true,
    connected: Boolean(data),
    googleEmail: data?.google_email ?? null,
    calendarId: data?.calendar_id ?? null,
    defaultDomain: (data?.default_domain as Domain | null) ?? null
  });
}

export async function PATCH(request: Request) {
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

  const { defaultDomain } = (await request.json()) as { defaultDomain?: Domain };

  if (!defaultDomain || !DOMAIN_OPTIONS.includes(defaultDomain)) {
    return NextResponse.json({ error: "Select a valid default space." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("google_calendar_connections")
    .update({
      default_domain: defaultDomain
    })
    .eq("user_id", user.id)
    .select("google_email, calendar_id, default_domain")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    configured: true,
    connected: true,
    googleEmail: data.google_email ?? null,
    calendarId: data.calendar_id ?? null,
    defaultDomain: (data.default_domain as Domain | null) ?? null
  });
}
