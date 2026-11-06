import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import type { Viewer } from "@/components/providers/viewer-provider";
import { supabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user and their profile, memoised per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Signed-in pages are always per-request, never prerendered at build time.
  await connection();
  if (!supabaseEnv()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, plan, credits")
    .eq("id", claims.sub)
    .maybeSingle();

  if (profile) return { id: claims.sub, email: profile.email, plan: profile.plan, credits: profile.credits };

  // Accounts created before the signup trigger existed: create the Free profile now.
  const email = typeof claims.email === "string" ? claims.email : "";
  await createAdminClient().from("profiles").upsert({ id: claims.sub, email }, { onConflict: "id", ignoreDuplicates: true });
  return { id: claims.sub, email, plan: "free", credits: 0 };
});

export async function requireViewer(next = "/dashboard") {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}
