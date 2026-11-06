import { supabaseEnv } from "@/lib/env";

/**
 * Which OAuth providers are switched on in Supabase. The login page only offers a
 * provider once it works, instead of sending people to Supabase's error page.
 */
export async function enabledProviders(): Promise<{ google: boolean }> {
  const env = supabaseEnv();
  if (!env) return { google: false };
  try {
    const response = await fetch(`${env.url}/auth/v1/settings`, {
      headers: { apikey: env.anonKey },
      next: { revalidate: 60 },
    });
    if (!response.ok) return { google: false };
    const settings = (await response.json()) as { external?: Record<string, boolean> };
    return { google: Boolean(settings.external?.google) };
  } catch {
    return { google: false };
  }
}
