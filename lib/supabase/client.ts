import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/db/types";

/**
 * Browser client. NEXT_PUBLIC_* values are inlined when the dev server compiles, so a
 * server started before .env.local existed has none — fail with a clear error the UI
 * can catch, instead of the SDK's crash.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("SUPABASE_NOT_CONFIGURED");
  return createBrowserClient<Database>(url, anonKey);
}
