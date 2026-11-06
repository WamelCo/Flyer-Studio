import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

let admin: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Service-role client. Bypasses RLS — server routes only, and only after the caller's
 * identity has been verified. The credit RPCs are executable by this role alone.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("SUPABASE_NOT_CONFIGURED");

  admin ??= createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
