import { sql } from "drizzle-orm";
import { log } from "@flyer/log";

import { query } from "./client";

/**
 * Fixed-window rate limits in Postgres (`rate_limit_hit`) — no extra service to run.
 * Fails open: if the database is unreachable, requests are allowed and a warning is
 * logged, because a limiter outage must never take generation down with it.
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
    const [row] = await query<{ allowed: boolean; remaining: number; reset_at: Date | string }>(
      sql`select * from public.rate_limit_hit(${key}, ${max}::integer, ${windowSeconds}::integer)`,
    );
    if (!row) throw new Error("rate_limit_hit returned no row");
    const retryAfter = Math.max(0, (new Date(row.reset_at).getTime() - Date.now()) / 1000);
    return { allowed: row.allowed, remaining: Number(row.remaining), retryAfter };
  } catch (error) {
    if (!warned) {
      warned = true;
      log.warn("rate_limit.unavailable", { reason: error instanceof Error ? error.message : String(error) });
    }
    return { allowed: true, remaining: max, retryAfter: 0 };
  }
}

/** Advances every counter; `blocked` when any is over its limit. */
export async function check(limits: Limit[]): Promise<{ blocked: boolean; retryAfter: number }> {
  const results = await Promise.all(limits.map(hit));
  const blocked = results.filter((r) => !r.allowed);
  if (!blocked.length) return { blocked: false, retryAfter: 0 };
  const retryAfter = Math.ceil(Math.max(...blocked.map((r) => r.retryAfter)));
  log.info("rate_limit.blocked", { keys: limits.filter((_, i) => !results[i]!.allowed).map((l) => l.key.split(":").slice(0, 2).join(":")), retryAfter });
  return { blocked: true, retryAfter };
}

/** Limits per surface. Generous for people, tight enough to stop scripts and runaway spend. */
export const LIMITS = {
  generate: (userId: string): Limit[] => [
    { key: `generate:min:${userId}`, max: 6, windowSeconds: 60 },
    { key: `generate:day:${userId}`, max: 200, windowSeconds: 86_400 },
  ],
  photos: (userId: string): Limit[] => [{ key: `photos:min:${userId}`, max: 30, windowSeconds: 60 }],
  export: (userId: string): Limit[] => [{ key: `export:min:${userId}`, max: 20, windowSeconds: 60 }],
  upload: (userId: string): Limit[] => [
    { key: `upload:min:${userId}`, max: 30, windowSeconds: 60 },
    { key: `upload:day:${userId}`, max: 500, windowSeconds: 86_400 },
  ],
  // Each attempt creates a Paynow transaction: a few a minute is plenty for a real customer.
  checkout: (userId: string): Limit[] => [
    { key: `checkout:min:${userId}`, max: 5, windowSeconds: 60 },
    { key: `checkout:day:${userId}`, max: 40, windowSeconds: 86_400 },
  ],
  /** Sign-in codes cost an email or a WhatsApp message: per recipient and in total. */
  otp: (recipient: string): Limit[] => [
    { key: `otp:min:${recipient}`, max: 2, windowSeconds: 60 },
    { key: `otp:hour:${recipient}`, max: 6, windowSeconds: 3_600 },
    { key: "otp:hour:all", max: Number(process.env.OTP_HOURLY_LIMIT || 600), windowSeconds: 3_600 },
  ],
  /** Messages one WhatsApp number may send the bot. */
  whatsapp: (phone: string): Limit[] => [
    { key: `whatsapp:min:${phone}`, max: 12, windowSeconds: 60 },
    { key: `whatsapp:day:${phone}`, max: 300, windowSeconds: 86_400 },
  ],
};
