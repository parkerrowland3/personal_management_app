import "server-only";

import type { User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { getSupabaseAdminClient, isServerSupabaseConfigured } from "@/lib/supabase-admin";

export async function getAuthenticatedUserFromRequest(request: NextRequest): Promise<User | null> {
  if (!isServerSupabaseConfigured()) {
    return null;
  }

  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const accessToken = authorization.slice("Bearer ".length);
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error) {
    return null;
  }

  return data.user;
}

