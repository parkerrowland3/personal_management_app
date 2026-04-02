import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuthenticatedUserFromRequest } from "@/lib/server-auth";
import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";
import type { Task } from "@/lib/types";

type CompletionAction = "complete" | "skip";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const nextRequest = request as NextRequest;
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

  const { taskId } = await context.params;
  const body = (await request.json().catch(() => null)) as { action?: CompletionAction } | null;
  const action = body?.action ?? "complete";

  if (!taskId) {
    return NextResponse.json({ error: "Task ID is required." }, { status: 400 });
  }

  if (action !== "complete" && action !== "skip") {
    return NextResponse.json({ error: "Unsupported completion action." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.rpc("complete_task_occurrence", {
    p_action: action,
    p_task_id: taskId,
    p_user_id: user.id
  });

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to complete the task." },
      { status: 400 }
    );
  }

  const payload = data as { task?: Task; nextTask?: Task | null };

  return NextResponse.json({
    task: payload.task ?? null,
    nextTask: payload.nextTask ?? null
  });
}
