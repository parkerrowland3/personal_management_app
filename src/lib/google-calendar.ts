import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

import type { Task } from "@/lib/types";

type OAuthStatePayload = {
  nonce: string;
  timestamp: number;
  userId: string;
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

export type GoogleCalendarConnectionRecord = {
  user_id: string;
  google_email: string | null;
  calendar_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export function isGoogleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_STATE_SECRET
  );
}

function getGoogleConfig() {
  if (!isGoogleCalendarConfigured()) {
    throw new Error("Google Calendar integration is not configured.");
  }

  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    stateSecret: process.env.GOOGLE_OAUTH_STATE_SECRET!
  };
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createOAuthState(userId: string) {
  const { stateSecret } = getGoogleConfig();
  const payload: OAuthStatePayload = {
    nonce: randomBytes(16).toString("hex"),
    timestamp: Date.now(),
    userId
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, stateSecret);

  return `${encodedPayload}.${signature}`;
}

export function verifyOAuthState(state: string) {
  const { stateSecret } = getGoogleConfig();
  const [encodedPayload, signature] = state.split(".");

  if (!encodedPayload || !signature) {
    throw new Error("Missing OAuth state.");
  }

  const expected = signPayload(encodedPayload, stateSecret);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid OAuth state signature.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as OAuthStatePayload;

  if (Date.now() - payload.timestamp > 15 * 60 * 1000) {
    throw new Error("OAuth state expired.");
  }

  return payload;
}

export function buildGoogleAuthUrl(origin: string, state: string) {
  const { clientId } = getGoogleConfig();
  const redirectUri = `${origin}/api/google-calendar/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeCodeForTokens(origin: string, code: string) {
  const { clientId, clientSecret } = getGoogleConfig();
  const redirectUri = `${origin}/api/google-calendar/callback`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token exchange failed: ${body}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

export async function refreshGoogleAccessToken(origin: string, refreshToken: string) {
  const { clientId, clientSecret } = getGoogleConfig();
  const redirectUri = `${origin}/api/google-calendar/callback`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      redirect_uri: redirectUri
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token refresh failed: ${body}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

export async function fetchGoogleEmail(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { email?: string };
  return payload.email ?? null;
}

export async function ensureFreshAccessToken(
  origin: string,
  connection: GoogleCalendarConnectionRecord
) {
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : null;

  if (expiresAt && expiresAt > Date.now() + 60_000) {
    return {
      accessToken: connection.access_token,
      refreshToken: connection.refresh_token,
      expiresAt: connection.expires_at
    };
  }

  if (!connection.refresh_token) {
    return {
      accessToken: connection.access_token,
      refreshToken: connection.refresh_token,
      expiresAt: connection.expires_at
    };
  }

  const refreshed = await refreshGoogleAccessToken(origin, connection.refresh_token);

  return {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? connection.refresh_token,
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  };
}

export function buildCalendarEventPayload(task: Task) {
  if (!task.due_date) {
    throw new Error("Task must have a due date before it can be synced.");
  }

  const nextDay = new Date(`${task.due_date}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);

  return {
    summary: task.title,
    description: [
      task.description?.trim() || "No additional notes.",
      "",
      "Synced from Focus Desk.",
      `Domain: ${task.domain}`,
      `Status: ${task.status}`,
      `Priority: ${task.priority}`
    ].join("\n"),
    start: {
      date: task.due_date
    },
    end: {
      date: nextDay.toISOString().slice(0, 10)
    },
    extendedProperties: {
      private: {
        focusDeskTaskId: task.id
      }
    }
  };
}

