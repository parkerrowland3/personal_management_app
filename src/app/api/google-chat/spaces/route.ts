import { NextResponse } from "next/server";

import {
  ensureFreshGoogleChatAccessToken,
  getGoogleChatMessageText,
  getGoogleChatSpaceDisplayName,
  getGoogleChatSpaceReadState,
  listGoogleChatMessages,
  listGoogleChatSpaceMembers,
  listGoogleChatSpaces,
  resolveGoogleChatUserName,
  resolveGoogleUserDisplayNames,
  type GoogleChatConnectionRecord
} from "@/lib/google-chat";
import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";
import type { GoogleChatSpace, GoogleChatSpaceType } from "@/lib/types";

function getTimestampValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const next = new Date(value).getTime();
  return Number.isFinite(next) ? next : 0;
}

async function resolveDirectMessageDisplayNames(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  accessToken: string,
  userId: string,
  spaces: Array<{ name: string; spaceType?: string }>,
  selfUserName: string | null
) {
  const directMessages = spaces.filter((space) => space.spaceType === "DIRECT_MESSAGE");
  const { data: aliases } = await supabase
    .from("google_chat_aliases")
    .select("target_name, label")
    .eq("user_id", userId)
    .eq("target_type", "space")
    .in("target_name", spaces.length ? spaces.map((space) => space.name) : [""]);

  const aliasMap = Object.fromEntries(
    (aliases ?? []).map((alias) => [alias.target_name as string, alias.label as string])
  );
  const unresolvedDirectMessages = directMessages.filter((space) => !aliasMap[space.name]);
  const dmUserNames = await Promise.all(
    unresolvedDirectMessages.map(async (space) => {
      try {
        const members = await listGoogleChatSpaceMembers(accessToken, space.name);
        const otherHumanMember = members.find(
          (member) =>
            member.member?.type === "HUMAN" &&
            member.member?.name &&
            member.member.name !== selfUserName
        );

        return [space.name, otherHumanMember?.member?.name ?? null] as const;
      } catch {
        return [space.name, null] as const;
      }
    })
  );

  const displayNames = await resolveGoogleUserDisplayNames(
    accessToken,
    dmUserNames.map((entry) => entry[1]).filter((value): value is string => Boolean(value))
  ).catch(() => ({} as Record<string, string>));

  return {
    ...Object.fromEntries(
      dmUserNames
        .map(([spaceName, userName]) => {
          if (!userName || !displayNames[userName]) {
            return null;
          }

          return [spaceName, displayNames[userName]] as const;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry))
    ),
    ...aliasMap
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

    const spaces = await listGoogleChatSpaces(refreshed.accessToken);
    const sortedSpaces = [...spaces].sort(
      (left, right) =>
        getTimestampValue(right.lastActiveTime) - getTimestampValue(left.lastActiveTime)
    );

    const chatUserName =
      connection.chat_user_name ??
      (await resolveGoogleChatUserName(
        refreshed.accessToken,
        sortedSpaces[0]?.name ?? "",
        connection.google_email ?? null
      ).catch(() => null));

    if (chatUserName && chatUserName !== connection.chat_user_name) {
      await supabase
        .from("google_chat_connections")
        .update({
          chat_user_name: chatUserName
        })
        .eq("user_id", user.id);
    }

    const directMessageDisplayNames = await resolveDirectMessageDisplayNames(
      supabase,
      refreshed.accessToken,
      user.id,
      sortedSpaces,
      chatUserName ?? null
    );

    const [readStates, previews] = await Promise.all([
      Promise.allSettled(
        sortedSpaces.map((space) => getGoogleChatSpaceReadState(refreshed.accessToken, space.name))
      ),
      Promise.allSettled(
        sortedSpaces.map(async (space) => {
          const [message] = await listGoogleChatMessages(refreshed.accessToken, space.name, 1);
          return message ?? null;
        })
      )
    ]);

    const normalizedSpaces: GoogleChatSpace[] = sortedSpaces
      .map((space, index) => {
        const readState =
          readStates[index]?.status === "fulfilled" ? readStates[index].value : null;
        const preview = previews[index]?.status === "fulfilled" ? previews[index].value : null;
        const lastActiveTime = space.lastActiveTime ?? preview?.createTime ?? null;
        const lastReadTime = readState?.lastReadTime ?? null;
        const unread =
          Boolean(lastActiveTime) && getTimestampValue(lastReadTime) < getTimestampValue(lastActiveTime);

        return {
          name: space.name,
          displayName:
            directMessageDisplayNames[space.name] ?? getGoogleChatSpaceDisplayName(space),
          spaceType: (space.spaceType as GoogleChatSpaceType) ?? "SPACE",
          lastActiveTime,
          lastReadTime,
          unread,
          previewText: preview ? getGoogleChatMessageText(preview) : null
        };
      })
      .sort((left, right) => {
        if (left.unread !== right.unread) {
          return left.unread ? -1 : 1;
        }

        return getTimestampValue(right.lastActiveTime) - getTimestampValue(left.lastActiveTime);
      });

    const unreadCount = normalizedSpaces.filter((space) => space.unread).length;

    return NextResponse.json({
      spaces: normalizedSpaces,
      unreadCount,
      hasUnread: unreadCount > 0,
      chatUserName: chatUserName ?? null
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Unable to load Google Chat spaces.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
