import { NextResponse } from "next/server";

import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      feedId: string;
    }>;
  }
) {
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

  const { feedId } = await context.params;
  const { name, url } = (await request.json()) as { name?: string; url?: string };

  if (!url?.trim()) {
    return NextResponse.json({ error: "Feed URL is required." }, { status: 400 });
  }

  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Feed URL must use HTTP or HTTPS.");
    }
  } catch {
    return NextResponse.json({ error: "Enter a valid ICS URL." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("calendar_feeds")
    .update({
      name: name?.trim() || null,
      url: url.trim()
    })
    .eq("id", feedId)
    .eq("user_id", user.id)
    .select("id, name, url")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ feed: data });
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{
      feedId: string;
    }>;
  }
) {
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

  const { feedId } = await context.params;
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("calendar_feeds")
    .delete()
    .eq("id", feedId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
