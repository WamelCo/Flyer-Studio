import { purgeExpiredFreeProjects } from "@flyer/db";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Free plan: one month of data retention (.claude/rules/pricing.md). Runs once a minute
 * after boot, then daily. Safe with several API replicas — the delete is idempotent.
 * Set RETENTION_JOB=off to disable (e.g. when an external cron calls the SQL function).
 */
export function scheduleRetention() {
  if (process.env.RETENTION_JOB === "off") return;
  const run = () =>
    purgeExpiredFreeProjects()
      .then((deleted) => {
        if (deleted > 0) console.log(`[retention] purged ${deleted} expired Free project${deleted === 1 ? "" : "s"}`);
      })
      .catch((error: unknown) => console.error("[retention] purge failed", error));
  setTimeout(run, 60_000).unref();
  setInterval(run, DAY).unref();
}
