import { ApiException } from "@/lib/api/server";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limits backed by Postgres (`rate_limit_hit`, Phase 0 migration) — no
 * extra service to run. Fails open: if the database function is missing (migration not
 * applied yet) or unreachable, requests are allowed and a warning is logged, because a
 * limiter outage must never take generation down with it.
 */

export interface Limit {
  /** Unique counter name, e.g. `generate:min:<userId>`. */
  key: string;
  max: number;
  windowSeconds: number;
}

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets (0 when unknown). */
  retryAfter: number;
}

let warned = false;

export async function hit({ key, max, windowSeconds }: Limit): Promise<LimitResult> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key: key, p_limit: max, p_window_seconds: windowSeconds });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; remaining: number; reset_at: string } | undefined;
    if (!row) throw new Error("rate_limit_hit returned no row");
    const retryAfter = Math.max(0, (new Date(row.reset_at).getTime() - Date.now()) / 1000);
    return { allowed: row.allowed, remaining: row.remaining, retryAfter };
  } catch (error) {
    if (!warned) {
      warned = true;
      log.warn("rate_limit.unavailable", { reason: error instanceof Error ? error.message : String(error), hint: "apply supabase/migrations/20261107000000_phase0_jobs_rate_limits.sql" });
    }
    return { allowed: true, remaining: max, retryAfter: 0 };
  }
}

/** Checks every limit (all counters advance) and throws RATE_LIMITED if any is exceeded. */
export async function enforce(limits: Limit[], message: string) {
  const results = await Promise.all(limits.map(hit));
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length) {
    const retryAfter = Math.max(...blocked.map((r) => r.retryAfter));
    log.info("rate_limit.blocked", { keys: limits.filter((_, i) => !results[i]!.allowed).map((l) => l.key.split(":").slice(0, 2).join(":")), retryAfter });
    throw new ApiException("RATE_LIMITED", message, { retryAfter: Math.ceil(retryAfter) });
  }
}

/** Limits per surface. Generous for people, tight enough to stop scripts and runaway spend. */
export const LIMITS = {
  generate: (userId: string): Limit[] => [
    { key: `generate:min:${userId}`, max: 6, windowSeconds: 60 },
    { key: `generate:day:${userId}`, max: 200, windowSeconds: 86_400 },
  ],
  photos: (userId: string): Limit[] => [{ key: `photos:min:${userId}`, max: 30, windowSeconds: 60 }],
  export: (userId: string): Limit[] => [{ key: `export:min:${userId}`, max: 20, windowSeconds: 60 }],
};

/**
 * Ideogram costs real money per image, so its use is capped per user and in total per
 * day (IDEOGRAM_DAILY_LIMIT, default 300). Over the cap, the lead is designed by the
 * layout engine instead — the user still gets three designs.
 */
export async function ideogramAllowed(userId: string) {
  const total = Number(process.env.IDEOGRAM_DAILY_LIMIT || 300);
  const perUser = Number(process.env.IDEOGRAM_USER_DAILY_LIMIT || 40);
  const [user, all] = await Promise.all([
    hit({ key: `ideogram:day:${userId}`, max: perUser, windowSeconds: 86_400 }),
    hit({ key: "ideogram:day:all", max: total, windowSeconds: 86_400 }),
  ]);
  if (!all.allowed) log.warn("ideogram.daily_cap_reached", { limit: total });
  return user.allowed && all.allowed;
}
