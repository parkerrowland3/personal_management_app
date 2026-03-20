import { NextResponse } from "next/server";

import {
  exchangeGoogleChatCodeForTokens,
  fetchGoogleEmail,
  isGoogleChatConfigured,
  verifyGoogleChatOAuthState
} from "@/lib/google-chat";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const callbackUrl = new URL(request.url);
  const origin = callbackUrl.origin;
  const redirectUrl = new URL("/", origin);
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const error = callbackUrl.searchParams.get("error");

  if (error) {
    redirectUrl.searchParams.set("chat_error", error);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !state) {
    redirectUrl.searchParams.set("chat_error", "missing_callback_params");
    return NextResponse.redirect(redirectUrl);
  }

  if (!isGoogleChatConfigured() || !isServerSupabaseConfigured()) {
    redirectUrl.searchParams.set("chat_error", "server_configuration_missing");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const payload = verifyGoogleChatOAuthState(state);
    const tokens = await exchangeGoogleChatCodeForTokens(origin, code);
    const supabase = getSupabaseAdminClient();
    const { data: existingConnection } = await supabase
      .from("google_chat_connections")
      .select("refresh_token, chat_user_name")
      .eq("user_id", payload.userId)
      .maybeSingle();

    const googleEmail = await fetchGoogleEmail(tokens.access_token);

    await supabase.from("google_chat_connections").upsert({
      user_id: payload.userId,
      google_email: googleEmail,
      chat_user_name: existingConnection?.chat_user_name ?? null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? existingConnection?.refresh_token ?? null,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    });

    redirectUrl.searchParams.set("chat", "connected");
    return NextResponse.redirect(redirectUrl);
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "chat_connection_failed";
    redirectUrl.searchParams.set("chat_error", message);
    return NextResponse.redirect(redirectUrl);
  }
}
