import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

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

export type GoogleChatConnectionRecord = {
  user_id: string;
  google_email: string | null;
  chat_user_name: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export type GoogleChatSpaceRecord = {
  name: string;
  displayName?: string;
  spaceType?: "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE" | string;
  lastActiveTime?: string;
};

export type GoogleChatMessageRecord = {
  name: string;
  text?: string;
  formattedText?: string;
  createTime?: string;
  sender?: {
    name?: string;
    type?: string;
    displayName?: string;
  };
  thread?: {
    name?: string;
  };
};

type GoogleChatReadState = {
  name: string;
  lastReadTime?: string;
};

type GoogleChatMembershipRecord = {
  name: string;
  member?: {
    name?: string;
    type?: string;
    displayName?: string;
  };
};

export function isGoogleChatConfigured() {
  return Boolean(
    process.env.GOOGLE_CHAT_CLIENT_ID &&
      process.env.GOOGLE_CHAT_CLIENT_SECRET &&
      process.env.GOOGLE_CHAT_OAUTH_STATE_SECRET
  );
}

function getGoogleChatConfig() {
  if (!isGoogleChatConfigured()) {
    throw new Error("Google Chat integration is not configured.");
  }

  return {
    clientId: process.env.GOOGLE_CHAT_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CHAT_CLIENT_SECRET!,
    stateSecret: process.env.GOOGLE_CHAT_OAUTH_STATE_SECRET!
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

function getChatScope() {
  return [
    "https://www.googleapis.com/auth/chat.spaces.readonly",
    "https://www.googleapis.com/auth/chat.messages",
    "https://www.googleapis.com/auth/chat.users.readstate",
    "https://www.googleapis.com/auth/chat.memberships.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
  ].join(" ");
}

function getChatSpaceId(spaceName: string) {
  return spaceName.replace(/^spaces\//, "");
}

function getChatSpacePath(spaceName: string) {
  return spaceName.startsWith("spaces/") ? spaceName : `spaces/${spaceName}`;
}

async function googleChatFetch<T>(
  url: string | URL,
  accessToken: string,
  init?: RequestInit,
  errorPrefix = "Google Chat request failed"
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${errorPrefix}: ${body}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export function createGoogleChatOAuthState(userId: string) {
  const { stateSecret } = getGoogleChatConfig();
  const payload: OAuthStatePayload = {
    nonce: randomBytes(16).toString("hex"),
    timestamp: Date.now(),
    userId
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, stateSecret);

  return `${encodedPayload}.${signature}`;
}

export function verifyGoogleChatOAuthState(state: string) {
  const { stateSecret } = getGoogleChatConfig();
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

export function buildGoogleChatAuthUrl(origin: string, state: string) {
  const { clientId } = getGoogleChatConfig();
  const redirectUri = `${origin}/api/google-chat/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", getChatScope());
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeGoogleChatCodeForTokens(origin: string, code: string) {
  const { clientId, clientSecret } = getGoogleChatConfig();
  const redirectUri = `${origin}/api/google-chat/callback`;

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
    throw new Error(`Google Chat token exchange failed: ${body}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

export async function refreshGoogleChatAccessToken(origin: string, refreshToken: string) {
  const { clientId, clientSecret } = getGoogleChatConfig();
  const redirectUri = `${origin}/api/google-chat/callback`;

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
    throw new Error(`Google Chat token refresh failed: ${body}`);
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

export async function ensureFreshGoogleChatAccessToken(
  origin: string,
  connection: GoogleChatConnectionRecord
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

  const refreshed = await refreshGoogleChatAccessToken(origin, connection.refresh_token);

  return {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? connection.refresh_token,
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  };
}

export async function listGoogleChatSpaces(accessToken: string) {
  const url = new URL("https://chat.googleapis.com/v1/spaces");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set(
    "filter",
    'spaceType = "SPACE" OR spaceType = "GROUP_CHAT" OR spaceType = "DIRECT_MESSAGE"'
  );

  const payload = await googleChatFetch<{ spaces?: GoogleChatSpaceRecord[] }>(
    url,
    accessToken,
    undefined,
    "Google Chat space fetch failed"
  );

  return payload.spaces ?? [];
}

export async function listGoogleChatMessages(accessToken: string, spaceName: string, pageSize = 40) {
  const url = new URL(`https://chat.googleapis.com/v1/${getChatSpacePath(spaceName)}/messages`);
  url.searchParams.set("pageSize", `${pageSize}`);
  url.searchParams.set("orderBy", "createTime DESC");

  const payload = await googleChatFetch<{ messages?: GoogleChatMessageRecord[] }>(
    url,
    accessToken,
    undefined,
    "Google Chat message fetch failed"
  );

  return payload.messages ?? [];
}

export async function createGoogleChatMessage(
  accessToken: string,
  spaceName: string,
  text: string
) {
  return googleChatFetch<GoogleChatMessageRecord>(
    `https://chat.googleapis.com/v1/${getChatSpacePath(spaceName)}/messages`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        text
      })
    },
    "Google Chat message send failed"
  );
}

export async function getGoogleChatSpaceReadState(accessToken: string, spaceName: string) {
  const spaceId = getChatSpaceId(spaceName);

  return googleChatFetch<GoogleChatReadState>(
    `https://chat.googleapis.com/v1/users/me/spaces/${encodeURIComponent(spaceId)}/spaceReadState`,
    accessToken,
    {
      headers: {
        "Content-Type": "application/json"
      }
    },
    "Google Chat read-state fetch failed"
  );
}

export async function updateGoogleChatSpaceReadState(
  accessToken: string,
  spaceName: string,
  lastReadTime: string
) {
  const spaceId = getChatSpaceId(spaceName);
  const name = `users/me/spaces/${spaceId}/spaceReadState`;
  const url = new URL(`https://chat.googleapis.com/v1/${name}`);
  url.searchParams.set("updateMask", "lastReadTime");

  return googleChatFetch<GoogleChatReadState>(
    url,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify({
        name,
        lastReadTime
      })
    },
    "Google Chat read-state update failed"
  );
}

export async function resolveGoogleChatUserName(
  accessToken: string,
  spaceName: string,
  googleEmail: string | null
) {
  if (!googleEmail) {
    return null;
  }

  const membership = await googleChatFetch<GoogleChatMembershipRecord>(
    `https://chat.googleapis.com/v1/${spaceName}/members/${encodeURIComponent(googleEmail)}`,
    accessToken,
    undefined,
    "Google Chat membership lookup failed"
  );

  return membership.member?.name ?? null;
}

export function getGoogleChatSpaceDisplayName(space: GoogleChatSpaceRecord) {
  const displayName = space.displayName?.trim();

  if (displayName) {
    return displayName;
  }

  if (space.spaceType === "DIRECT_MESSAGE") {
    return "Direct message";
  }

  if (space.spaceType === "GROUP_CHAT") {
    return "Group chat";
  }

  return "Untitled space";
}

export function getGoogleChatMessageText(message: GoogleChatMessageRecord) {
  const candidate = message.text?.trim() || message.formattedText?.trim() || "";
  const normalized = candidate.replace(/\s+/g, " ").trim();

  return normalized || "Sent an attachment";
}
