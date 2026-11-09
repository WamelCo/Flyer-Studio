import { sql, type SQL } from "drizzle-orm";
import { log } from "@flyer/log";

import { query } from "./client";

/**
 * Scheduled database upkeep (what pg_cron did on Supabase). The web app runs it in-process
 * (instrumentation.ts); every task is idempotent, so a second instance running it is harmless.
 */

const count = async (statement: SQL) => Number((await query<{ n: number }>(statement))[0]?.n ?? 0);
const deleted = (statement: SQL) => count(sql`with gone as (${statement} returning 1) select count(*)::integer as n from gone`);

export const TASKS = [
  // Jobs silent for 5 minutes are failed and refunded (same refund key as the app).
  { name: "fail-stale-generation-jobs", everyMs: 60_000, run: () => count(sql`select public.fail_stale_generation_jobs() as n`) },
  // Ended passes go back to Free (the app already reads them as Free).
  { name: "expire-lapsed-passes", everyMs: 60 * 60_000, run: () => count(sql`select public.expire_lapsed_passes() as n`) },
  // Free plan: one month of data retention.
  { name: "purge-expired-free-projects", everyMs: 24 * 60 * 60_000, run: () => count(sql`select public.purge_expired_free_projects() as n`) },
  { name: "purge-rate-limits", everyMs: 60 * 60_000, run: () => deleted(sql`delete from public.rate_limits where window_start < now() - interval '2 days'`) },
  {
    name: "purge-expired-auth",
    everyMs: 60 * 60_000,
    run: async () =>
      (await deleted(sql`delete from public.session where expires_at < now()`)) +
      (await deleted(sql`delete from public.verification where expires_at < now() - interval '1 day'`)),
  },
  {
    name: "purge-whatsapp-message-ids",
    everyMs: 24 * 60 * 60_000,
    run: () => deleted(sql`delete from public.whatsapp_messages where received_at < now() - interval '14 days'`),
  },
] as const;

/** Runs each task on its interval (first run shortly after start). Returns a stop function. */
export function startMaintenance(): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const task of TASKS) {
    const tick = async () => {
      try {
        const changed = await task.run();
        if (changed) log.info("maintenance.ran", { task: task.name, changed });
      } catch (error) {
        log.warn("maintenance.failed", { task: task.name, reason: error instanceof Error ? error.message : String(error) });
      }
    };
    timers.push(setTimeout(tick, 15_000 + Math.random() * 15_000));
    timers.push(setInterval(tick, task.everyMs));
  }
  for (const timer of timers) timer.unref?.();
  return () => timers.forEach((timer) => clearTimeout(timer));
}
