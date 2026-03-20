import { NextResponse } from "next/server";

import {
  buildGoogleChatAuthUrl,
  createGoogleChatOAuthState,
  isGoogleChatConfigured
} from "@/lib/google-chat";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";

export async function POST(request: Request) {
  const nextRequest = request as unknown as import("next/server").NextRequest;
  const user = await getAuthenticatedUserFromRequest(nextRequest);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isGoogleChatConfigured()) {
    return NextResponse.json(
      { error: "Google Chat environment variables are missing." },
      { status: 500 }
    );
  }

  const origin = new URL(request.url).origin;
  const state = createGoogleChatOAuthState(user.id);
  const url = buildGoogleChatAuthUrl(origin, state);

  return NextResponse.json({ url });
}
