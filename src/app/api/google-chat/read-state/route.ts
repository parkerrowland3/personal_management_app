import { NextResponse } from "next/server";

import {
  ensureFreshGoogleChatAccessToken,
  updateGoogleChatSpaceReadState,
  type GoogleChatConnectionRecord
} from "@/lib/google-chat";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";

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

  const { spaceName, lastReadTime } = (await request.json()) as {
    spaceName?: string;
    lastReadTime?: string | null;
  };

  if (!spaceName) {
    return NextResponse.json({ error: "Space name is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: connection, error: connectionError } = await supabase
    .from("google_chat_connections")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (connectionError || !connection) {
    return NextResponse.json(
      { error: connectionError?.message ?? "Google Chat is not connected." },
      { status: 400 }
    );
  }

  try {
    const origin = new URL(request.url).origin;
    const refreshed = await ensureFreshGoogleChatAccessToken(
      origin,
      connection as GoogleChatConnectionRecord
    );

    if (
      refreshed.accessToken !== connection.access_token ||
      refreshed.refreshToken !== connection.refresh_token ||
      refreshed.expiresAt !== connection.expires_at
    ) {
      await supabase
        .from("google_chat_connections")
        .update({
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          expires_at: refreshed.expiresAt
        })
        .eq("user_id", user.id);
    }

    const nextLastReadTime = lastReadTime ?? new Date().toISOString();
    const readState = await updateGoogleChatSpaceReadState(
      refreshed.accessToken,
      spaceName,
      nextLastReadTime
    );

    return NextResponse.json({
      lastReadTime: readState.lastReadTime ?? nextLastReadTime
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Unable to update Google Chat read state.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
