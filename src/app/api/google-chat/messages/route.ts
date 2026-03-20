import { NextResponse } from "next/server";

import {
  createGoogleChatMessage,
  ensureFreshGoogleChatAccessToken,
  getGoogleChatMessageText,
  listGoogleChatMessages,
  resolveGoogleChatUserName,
  resolveGoogleWorkspaceUserDisplayName,
  type GoogleChatConnectionRecord,
  type GoogleChatMessageRecord
} from "@/lib/google-chat";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";
import type { GoogleChatMessage } from "@/lib/types";

function getSenderLabel(
  message: GoogleChatMessageRecord,
  isSelf: boolean,
  resolvedSenderName: string | null
) {
  if (isSelf) {
    return "You";
  }

  if (resolvedSenderName) {
    return resolvedSenderName;
  }

  const explicitLabel = message.sender?.displayName?.trim();

  if (explicitLabel) {
    return explicitLabel;
  }

  if (message.sender?.type === "BOT") {
    return "App";
  }

  return "Teammate";
}

async function resolveSenderDisplayNames(
  accessToken: string,
  messages: GoogleChatMessageRecord[]
) {
  const senderNames = Array.from(
    new Set(
      messages
        .map((message) => message.sender?.name ?? null)
        .filter((senderName): senderName is string => Boolean(senderName?.startsWith("users/")))
    )
  );

  const resolvedEntries = await Promise.all(
    senderNames.map(async (senderName) => {
      try {
        const displayName = await resolveGoogleWorkspaceUserDisplayName(accessToken, senderName);
        return [senderName, displayName] as const;
      } catch {
        return [senderName, null] as const;
      }
    })
  );

  return Object.fromEntries(
    resolvedEntries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );
}

function normalizeMessage(
  message: GoogleChatMessageRecord,
  selfUserName: string | null,
  senderDisplayNames: Record<string, string>
) {
  const isSelf = Boolean(selfUserName && message.sender?.name === selfUserName);
  const resolvedSenderName = message.sender?.name
    ? senderDisplayNames[message.sender.name] ?? null
    : null;

  return {
    name: message.name,
    text: getGoogleChatMessageText(message),
    createTime: message.createTime ?? null,
    senderName: message.sender?.name ?? null,
    senderType: message.sender?.type ?? null,
    senderLabel: getSenderLabel(message, isSelf, resolvedSenderName),
    isSelf,
    threadName: message.thread?.name ?? null
  } satisfies GoogleChatMessage;
}

async function getChatConnection(request: Request, userId: string) {
  const supabase = getSupabaseAdminClient();
  const { data: connection, error: connectionError } = await supabase
    .from("google_chat_connections")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (connectionError || !connection) {
    return {
      error: NextResponse.json(
        { error: connectionError?.message ?? "Google Chat is not connected." },
        { status: 400 }
      )
    };
  }

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
      .eq("user_id", userId);
  }

  let chatUserName = connection.chat_user_name ?? null;

  return {
    supabase,
    connection,
    accessToken: refreshed.accessToken,
    async resolveSelfUserName(spaceName: string) {
      if (chatUserName || !connection.google_email) {
        return chatUserName;
      }

      chatUserName = await resolveGoogleChatUserName(
        refreshed.accessToken,
        spaceName,
        connection.google_email
      ).catch(() => null);

      if (chatUserName) {
        await supabase
          .from("google_chat_connections")
          .update({
            chat_user_name: chatUserName
          })
          .eq("user_id", userId);
      }

      return chatUserName;
    }
  };
}

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const spaceName = searchParams.get("space");

  if (!spaceName) {
    return NextResponse.json({ error: "Space name is required." }, { status: 400 });
  }

  try {
    const connection = await getChatConnection(request, user.id);

    if ("error" in connection) {
      return connection.error;
    }

    const [selfUserName, rawMessages] = await Promise.all([
      connection.resolveSelfUserName(spaceName),
      listGoogleChatMessages(connection.accessToken, spaceName)
    ]);

    const senderDisplayNames = await resolveSenderDisplayNames(connection.accessToken, rawMessages);
    const messages = rawMessages.reverse().map((message) =>
      normalizeMessage(message, selfUserName, senderDisplayNames)
    );

    return NextResponse.json({ messages });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Unable to load Google Chat messages.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

  const { spaceName, text } = (await request.json()) as {
    spaceName?: string;
    text?: string;
  };
  const trimmedText = text?.trim();

  if (!spaceName) {
    return NextResponse.json({ error: "Space name is required." }, { status: 400 });
  }

  if (!trimmedText) {
    return NextResponse.json({ error: "Message text is required." }, { status: 400 });
  }

  try {
    const connection = await getChatConnection(request, user.id);

    if ("error" in connection) {
      return connection.error;
    }

    const createdMessage = await createGoogleChatMessage(connection.accessToken, spaceName, trimmedText);
    const selfUserName = (await connection.resolveSelfUserName(spaceName)) ?? createdMessage.sender?.name ?? null;
    const senderDisplayNames = await resolveSenderDisplayNames(connection.accessToken, [createdMessage]);

    return NextResponse.json({
      message: normalizeMessage(
        {
          ...createdMessage,
          sender: {
            ...createdMessage.sender,
            name: createdMessage.sender?.name ?? selfUserName ?? undefined
          }
        },
        selfUserName,
        senderDisplayNames
      )
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Unable to send the Google Chat message.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
