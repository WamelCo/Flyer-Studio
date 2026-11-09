/**
 * The real generation pipeline end to end against your Postgres (DATABASE_URL) and the
 * configured AI providers (reads the repo's .env.local). Uses a throwaway user that is
 * deleted afterwards.
 *   pnpm test:generation [--http] [--sweeper]
 *
 * Checks: credits are charged once; the job runs to `done` with its result stored; the
 * project holds the lead design; rate limits respond; a forced failure refunds exactly once.
 * --sweeper plants a silent job and runs the scheduled sweep; --http drives POST
 * /api/generate on a running server (pnpm dev) with a real Better Auth session.
 * Costs one art-director call (free tier) and a few Unsplash searches.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createJob, runJob } from "@flyer/ai/jobs";
import { addCredits, closeDb, db, deductCredits, eq, flyerProjects, generationJobs, getBalance, session, user } from "@flyer/db";
import { TASKS } from "@flyer/db/maintenance";
import { hit } from "@flyer/db/rate-limit";

const envFile = resolve(import.meta.dirname, "../../../.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL (and run pnpm db:migrate).");

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

async function createUser(label: string) {
  const id = randomUUID();
  await db().insert(user).values({ id, name: label, email: `${label}-${id}@example.test`, emailVerified: true });
  return id;
}

/** A real Better Auth session for a throwaway account, as the browser's cookie. */
async function sessionCookie(userId: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("--http needs BETTER_AUTH_SECRET (the same one the server uses)");
  const token = randomBytes(24).toString("base64url");
  await db().insert(session).values({ token, userId, expiresAt: new Date(Date.now() + 3_600_000) });
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

const userId = await createUser("generation-test");
const others: string[] = [];

try {
  await addCredits({ userId, amount: 10, reason: "test", idempotencyKey: `test:${userId}` });

  // ── Success ──────────────────────────────────────────────────────────────
  const jobId = randomUUID();
  const charge = await deductCredits({ userId, amount: 5, reason: "generate", idempotencyKey: `generate:${userId}:${jobId}` });
  assert.ok(charge.ok);
  assert.equal(charge.balance, 5);
  const input = { jobId, userId, prompt: "Summer jazz night at the Blue Room, Friday 8pm, tickets $15", format: "poster" as const, cost: 5, balance: charge.balance };
  await createJob(input);
  const started = Date.now();
  const outcome = await runJob(input);
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.message);
  ok(`designed 3 directions in ${((Date.now() - started) / 1000).toFixed(1)}s via ${outcome.response.source} (${outcome.response.directions.map((d) => d.layout).join(" / ")})`);
  assert.equal(outcome.response.docs.length, 3);

  const [project] = await db().select({ canvas: flyerProjects.canvas, title: flyerProjects.title }).from(flyerProjects).where(eq(flyerProjects.id, outcome.response.projectId));
  assert.ok((project?.canvas as { nodes?: unknown[] } | null)?.nodes?.length, "project canvas saved");
  ok(`project saved: "${project?.title}"`);

  const [job] = await db().select().from(generationJobs).where(eq(generationJobs.id, jobId));
  assert.equal(job?.status, "succeeded");
  assert.equal(job?.stage, "done");
  assert.ok(job?.result, "result stored for the client to poll");
  ok("job row: succeeded, stage done, result stored");
  assert.equal(await getBalance(userId), 5, "charged exactly once");

  // ── Failure refunds once ──────────────────────────────────────────────────
  const failId = randomUUID();
  await deductCredits({ userId, amount: 5, reason: "generate", idempotencyKey: `generate:${userId}:${failId}` });
  assert.equal(await getBalance(userId), 0);
  await createJob({ ...input, jobId: failId, balance: 0 });
  const logs = console.error;
  console.error = () => undefined;
  const failed = await runJob({ ...input, jobId: failId, balance: 0, format: "not-a-format" as "poster" });
  console.error = logs;
  assert.equal(failed.ok, false);
  assert.equal(await getBalance(userId), 5, "the failed job's credits came back");
  await addCredits({ userId, amount: 5, reason: "refund:generate", idempotencyKey: `refund:generate:${userId}:${failId}` });
  assert.equal(await getBalance(userId), 5, "a second refund with the same key is a no-op");
  ok("a failed job refunds exactly once (same key as the scheduled sweep)");

  // ── Rate limiter ─────────────────────────────────────────────────────────
  const key = `test:${userId}`;
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await hit({ key, max: 2, windowSeconds: 60 }));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, false]);
  ok("rate limiter: allows 2, refuses the 3rd");

  // ── Stale-job sweep (opt in) ─────────────────────────────────────────────
  if (process.argv.includes("--sweeper")) {
    const staleId = randomUUID();
    await deductCredits({ userId, amount: 5, reason: "generate", idempotencyKey: `generate:${userId}:${staleId}` });
    const before = await getBalance(userId);
    await db().insert(generationJobs).values({ id: staleId, userId, prompt: "stale", intent: "event", format: "poster", status: "running", stage: "designing", creditsSpent: 5, heartbeatAt: new Date(Date.now() - 10 * 60_000) });
    await TASKS.find((t) => t.name === "fail-stale-generation-jobs")!.run();
    const [swept] = await db().select({ status: generationJobs.status, errorCode: generationJobs.errorCode }).from(generationJobs).where(eq(generationJobs.id, staleId));
    assert.equal(swept?.status, "failed");
    assert.equal(swept?.errorCode, "GENERATION_TIMEOUT");
    assert.equal(await getBalance(userId), before + 5, "the stale job was refunded");
    ok("a job silent for 10 minutes is failed and refunded by the scheduled sweep");
  }

  // ── Through the HTTP API of a running server (opt in: --http, needs pnpm dev) ──
  if (process.argv.includes("--http")) {
    const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    await addCredits({ userId, amount: 5, reason: "test", idempotencyKey: `test:http:${userId}` });
    const cookie = await sessionCookie(userId);
    const startedHttp = Date.now();
    const post = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ prompt: "Grand opening of Juniper Bakery, fresh bread from 7am", format: "square" }),
    });
    const accepted = (await post.json()) as { jobId: string; status: string; balance: number };
    assert.equal(post.status, 202, JSON.stringify(accepted));
    assert.equal(accepted.status, "pending");
    ok(`POST /api/generate → 202 in ${Date.now() - startedHttp} ms (job ${accepted.jobId.slice(0, 8)}…, balance ${accepted.balance})`);

    const stages: string[] = [];
    let final: { status: string; result?: { docs: unknown[] } } | null = null;
    while (Date.now() - startedHttp < 120_000) {
      await new Promise((r) => setTimeout(r, 1200));
      const status = (await (await fetch(`${base}/api/generate/${accepted.jobId}`, { headers: { cookie } })).json()) as { status: string; stage: string | null; result?: { docs: unknown[] } };
      if (status.stage && stages.at(-1) !== status.stage) stages.push(status.stage);
      if (status.status === "succeeded" || status.status === "failed") {
        final = status;
        break;
      }
    }
    assert.equal(final?.status, "succeeded");
    assert.equal(final?.result?.docs.length, 3);
    ok(`polled to success in ${((Date.now() - startedHttp) / 1000).toFixed(1)}s through stages: ${stages.join(" → ")}`);

    // Another account can't read this job.
    const other = await createUser("generation-other");
    others.push(other);
    const peek = await fetch(`${base}/api/generate/${accepted.jobId}`, { headers: { cookie: await sessionCookie(other) } });
    assert.equal(peek.status, 404);
    ok("another account gets 404 for this job");
  }

  console.log(`\n${passed} passed`);
} finally {
  for (const id of [userId, ...others]) await db().delete(user).where(eq(user.id, id));
  console.log("cleaned up the test users (projects, jobs and ledger cascade)");
  await closeDb();
}
