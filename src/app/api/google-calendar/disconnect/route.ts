import { NextResponse } from "next/server";

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

  const supabase = getSupabaseAdminClient();

  const [{ error: deleteError }, { error: taskError }] = await Promise.all([
    supabase.from("google_calendar_connections").delete().eq("user_id", user.id),
    supabase
      .from("tasks")
      .update({
        google_calendar_event_id: null,
        google_calendar_event_url: null,
        google_calendar_last_synced_at: null
      })
      .eq("user_id", user.id)
  ]);

  if (deleteError || taskError) {
    return NextResponse.json(
      { error: deleteError?.message ?? taskError?.message ?? "Disconnect failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

