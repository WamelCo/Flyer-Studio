import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/db/types";
import { supabaseEnv } from "@/lib/env";

/** Request-scoped client acting as the signed-in user (RLS applies). */
export async function createClient() {
  // Read cookies first: it marks every caller as per-request, even when unconfigured.
  const cookieStore = await cookies();
  const env = supabaseEnv();
  if (!env) throw new Error("SUPABASE_NOT_CONFIGURED");

  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component; the proxy refreshes the session instead.
        }
      },
    },
  });
}
