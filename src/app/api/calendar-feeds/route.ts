import { NextResponse } from "next/server";

import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";
import { DOMAIN_OPTIONS, type Domain } from "@/lib/types";

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
  const { data, error } = await supabase
    .from("calendar_feeds")
    .select("id, name, url, domain")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ feeds: data ?? [] });
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

  const { name, url, domain } = (await request.json()) as {
    name?: string;
    url?: string;
    domain?: Domain;
  };

  if (!url) {
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

  if (!domain || !DOMAIN_OPTIONS.includes(domain)) {
    return NextResponse.json({ error: "Select a valid space for the feed." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("calendar_feeds")
    .insert({
      user_id: user.id,
      name: name?.trim() || null,
      url: url.trim(),
      domain
    })
    .select("id, name, url, domain")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ feed: data });
}
