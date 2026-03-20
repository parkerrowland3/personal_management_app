import { NextResponse } from "next/server";

import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";
import type { GoogleChatAliasTargetType } from "@/lib/types";

const GOOGLE_CHAT_ALIAS_TARGET_TYPES: GoogleChatAliasTargetType[] = ["space", "sender"];

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

  const { targetType, targetName, label } = (await request.json()) as {
    targetType?: GoogleChatAliasTargetType;
    targetName?: string;
    label?: string;
  };

  if (!targetType || !GOOGLE_CHAT_ALIAS_TARGET_TYPES.includes(targetType)) {
    return NextResponse.json({ error: "Select a valid alias target type." }, { status: 400 });
  }

  const normalizedTargetName = targetName?.trim();

  if (!normalizedTargetName) {
    return NextResponse.json({ error: "Target name is required." }, { status: 400 });
  }

  const normalizedLabel = label?.trim() ?? "";
  const supabase = getSupabaseAdminClient();

  if (!normalizedLabel) {
    const { error } = await supabase
      .from("google_chat_aliases")
      .delete()
      .eq("user_id", user.id)
      .eq("target_type", targetType)
      .eq("target_name", normalizedTargetName);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, label: null });
  }

  const { data, error } = await supabase
    .from("google_chat_aliases")
    .upsert({
      user_id: user.id,
      target_type: targetType,
      target_name: normalizedTargetName,
      label: normalizedLabel
    }, {
      onConflict: "user_id,target_type,target_name"
    })
    .select("target_type, target_name, label")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Unable to save the chat alias." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    alias: {
      targetType: data.target_type,
      targetName: data.target_name,
      label: data.label
    }
  });
}
