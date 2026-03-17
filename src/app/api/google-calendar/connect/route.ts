import { NextResponse } from "next/server";

import { buildGoogleAuthUrl, createOAuthState, isGoogleCalendarConfigured } from "@/lib/google-calendar";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";

export async function POST(request: Request) {
  const nextRequest = request as unknown as import("next/server").NextRequest;
  const user = await getAuthenticatedUserFromRequest(nextRequest);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json(
      { error: "Google Calendar environment variables are missing." },
      { status: 500 }
    );
  }

  const origin = new URL(request.url).origin;
  const state = createOAuthState(user.id);
  const url = buildGoogleAuthUrl(origin, state);

  return NextResponse.json({ url });
}

