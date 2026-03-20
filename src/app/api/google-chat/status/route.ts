import { NextResponse } from "next/server";

import { isGoogleChatConfigured } from "@/lib/google-chat";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const nextRequest = request as unknown as import("next/server").NextRequest;
  const user = await getAuthenticatedUserFromRequest(nextRequest);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isGoogleChatConfigured() || !isServerSupabaseConfigured()) {
    return NextResponse.json({
      configured: false,
      connected: false,
      googleEmail: null
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("google_chat_connections")
    .select("google_email")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    configured: true,
    connected: Boolean(data),
    googleEmail: data?.google_email ?? null
  });
}
