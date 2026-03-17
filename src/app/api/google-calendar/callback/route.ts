import { NextResponse } from "next/server";

import {
  exchangeCodeForTokens,
  fetchGoogleEmail,
  isGoogleCalendarConfigured,
  verifyOAuthState
} from "@/lib/google-calendar";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const callbackUrl = new URL(request.url);
  const origin = callbackUrl.origin;
  const redirectUrl = new URL("/", origin);
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const error = callbackUrl.searchParams.get("error");

  if (error) {
    redirectUrl.searchParams.set("calendar_error", error);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !state) {
    redirectUrl.searchParams.set("calendar_error", "missing_callback_params");
    return NextResponse.redirect(redirectUrl);
  }

  if (!isGoogleCalendarConfigured() || !isServerSupabaseConfigured()) {
    redirectUrl.searchParams.set("calendar_error", "server_configuration_missing");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const payload = verifyOAuthState(state);
    const tokens = await exchangeCodeForTokens(origin, code);
    const supabase = getSupabaseAdminClient();
    const { data: existingConnection } = await supabase
      .from("google_calendar_connections")
      .select("refresh_token, default_domain")
      .eq("user_id", payload.userId)
      .maybeSingle();

    const googleEmail = await fetchGoogleEmail(tokens.access_token);

    await supabase.from("google_calendar_connections").upsert({
      user_id: payload.userId,
      google_email: googleEmail,
      calendar_id: "primary",
      default_domain: existingConnection?.default_domain ?? "personal",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? existingConnection?.refresh_token ?? null,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    });

    redirectUrl.searchParams.set("calendar", "connected");
    return NextResponse.redirect(redirectUrl);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "calendar_connection_failed";
    redirectUrl.searchParams.set("calendar_error", message);
    return NextResponse.redirect(redirectUrl);
  }
}
