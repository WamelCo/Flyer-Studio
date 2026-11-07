/**
 * The real generation pipeline end to end against your Supabase project and the
 * configured AI providers (reads .env.local). Uses a throwaway user that is deleted after.
 *   pnpm test:generation
 *
 * Checks: credits are charged once; the job runs in background mode when the Phase 0
 * migration is applied (inline otherwise); the project row holds the lead design; the
 * job row records success; rate limits respond; a forced failure refunds exactly once.
 * Costs one art-director call (free tier) and a few Unsplash searches.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { addCredits, deductCredits, getBalance } from "@/lib/db/credits";
import { jobsReady, createJob, runJob } from "@/lib/generation/jobs";
import { hit } from "@/lib/rate-limit";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/**
 * A real session for a throwaway account, as the app's cookies: an admin-issued sign-in
 * link verified through @supabase/ssr (no password involved), serialised the way the
 * browser would send it.
 */
async function sessionCookies(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message}`);
  const jar = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const verified = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (verified.error) throw new Error(`verifyOtp failed: ${verified.error.message}`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}
let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const { data: created, error } = await admin.auth.admin.createUser({ email: `generation-test-${randomUUID()}@example.test`, email_confirm: true });
if (error || !created.user) throw new Error(`could not create test user: ${error?.message}`);
const userId = created.user.id;

try {
  await addCredits({ userId, amount: 10, reason: "test", idempotencyKey: `test:${userId}` });
  const mode = (await jobsReady()) ? "background" : "inline";
  console.log(`  mode: ${mode}${mode === "inline" ? " (Phase 0 migration not applied yet)" : ""}`);

  // ── Success ──────────────────────────────────────────────────────────────
  const jobId = randomUUID();
  const charge = await deductCredits({ userId, amount: 5, reason: "generate", idempotencyKey: `generate:${userId}:${jobId}` });
  assert.ok(charge.ok);
  assert.equal(charge.balance, 5);
  const input = { jobId, userId, prompt: "Summer jazz night at the Blue Room, Friday 8pm, tickets $15", format: "poster" as const, cost: 5, balance: charge.balance };
  if (mode === "background") await createJob(input);
  const started = Date.now();
  const outcome = await runJob(input, mode);
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.message);
  ok(`designed 3 directions in ${((Date.now() - started) / 1000).toFixed(1)}s via ${outcome.response.source} (${outcome.response.directions.map((d) => d.layout).join(" / ")})`);
  assert.equal(outcome.response.docs.length, 3);

  const { data: project } = await admin.from("flyer_projects").select("canvas, title").eq("id", outcome.response.projectId).single();
  assert.ok((project?.canvas as { nodes?: unknown[] } | null)?.nodes?.length, "project canvas saved");
  ok(`project saved: "${project?.title}"`);

  const { data: job } = await admin.from("generation_jobs").select("*").eq("id", jobId).single();
  assert.equal(job?.status, "succeeded");
  if (mode === "background") {
    assert.equal((job as { stage?: string }).stage, "done");
    assert.ok((job as { result?: unknown }).result, "result stored for the client to poll");
  }
  ok(`job row: ${job?.status}${mode === "background" ? ", stage done, result stored" : ""}`);
  assert.equal(await getBalance(userId), 5, "charged exactly once");

  // ── Failure refunds once ──────────────────────────────────────────────────
  const failId = randomUUID();
  await deductCredits({ userId, amount: 5, reason: "generate", idempotencyKey: `generate:${userId}:${failId}` });
  assert.equal(await getBalance(userId), 0);
  const failInput = { ...input, jobId: failId, balance: 0, format: "not-a-format" as "poster" };
  if (mode === "background") await createJob({ ...failInput, format: "poster" });
  const logs = console.error;
  console.error = () => undefined;
  const failed = await runJob(failInput, mode);
  console.error = logs;
  assert.equal(failed.ok, false);
  assert.equal(await getBalance(userId), 5, "the failed job's credits came back");
  await addCredits({ userId, amount: 5, reason: "refund:generate", idempotencyKey: `refund:generate:${userId}:${failId}` });
  assert.equal(await getBalance(userId), 5, "a second refund with the same key is a no-op");
  ok("a failed job refunds exactly once (same key as the database sweeper)");

  // ── Rate limiter ─────────────────────────────────────────────────────────
  const key = `test:${userId}`;
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await hit({ key, max: 2, windowSeconds: 60 }));
  if (results.every((r) => r.allowed && r.remaining === 2)) ok("rate limiter fails open (Phase 0 migration not applied yet)");
  else {
    assert.deepEqual(results.map((r) => r.allowed), [true, true, false]);
    ok("rate limiter: allows 2, refuses the 3rd");
  }

  // ── Stale-job sweeper (pg_cron, every minute) — opt in, it waits for the schedule ──
  if (process.argv.includes("--sweeper") && mode === "background") {
    const staleId = randomUUID();
    await deductCredits({ userId, amount: 5, reason: "generate", idempotencyKey: `generate:${userId}:${staleId}` });
    const before = await getBalance(userId);
    await admin.from("generation_jobs").insert({
      id: staleId, user_id: userId, prompt: "stale", intent: "event", format: "poster",
      status: "running", stage: "designing", credits_spent: 5, heartbeat_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    console.log("  … planted a job silent for 10 minutes; waiting for the sweeper");
    const startedSweep = Date.now();
    let swept: { status: string; error_code: string | null } | null = null;
    while (Date.now() - startedSweep < 150_000) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const { data } = await admin.from("generation_jobs").select("status, error_code").eq("id", staleId).single();
      if (data?.status === "failed") {
        swept = data;
        break;
      }
    }
    assert.ok(swept, "the sweeper didn't fail the stale job within 150 s — is pg_cron scheduled?");
    assert.equal(swept.error_code, "GENERATION_TIMEOUT");
    assert.equal(await getBalance(userId), before + 5, "the stale job was refunded");
    ok(`stale job failed and refunded by the database sweeper after ${Math.round((Date.now() - startedSweep) / 1000)}s`);
  }

  // ── Through the HTTP API of a running dev server (opt in: --http, needs `pnpm dev`) ──
  if (process.argv.includes("--http") && mode === "background") {
    const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    await addCredits({ userId, amount: 5, reason: "test", idempotencyKey: `test:http:${userId}` });
    const cookies = await sessionCookies(created.user.email!);
    const startedHttp = Date.now();
    const post = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify({ prompt: "Grand opening of Juniper Bakery, fresh bread from 7am", format: "square" }),
    });
    const accepted = (await post.json()) as { jobId: string; status: string; balance: number };
    assert.equal(post.status, 202, JSON.stringify(accepted));
    assert.equal(accepted.status, "pending");
    ok(`POST /api/generate → 202 in ${Date.now() - startedHttp} ms (job ${accepted.jobId.slice(0, 8)}…, balance ${accepted.balance})`);

    const stages: string[] = [];
    let final: { status: string; result?: { docs: unknown[] } } | null = null;
    while (Date.now() - startedHttp < 120_000) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const status = (await (await fetch(`${base}/api/generate/${accepted.jobId}`, { headers: { cookie: cookies } })).json()) as { status: string; stage: string | null; result?: { docs: unknown[] } };
      if (status.stage && stages.at(-1) !== status.stage) stages.push(status.stage);
      if (status.status === "succeeded" || status.status === "failed") {
        final = status;
        break;
      }
    }
    assert.equal(final?.status, "succeeded");
    assert.equal(final?.result?.docs.length, 3);
    ok(`polled to success in ${((Date.now() - startedHttp) / 1000).toFixed(1)}s through stages: ${stages.join(" → ")}`);

    // Another account can't read this job (RLS: owner only).
    const { data: other } = await admin.auth.admin.createUser({ email: `generation-other-${randomUUID()}@example.test`, email_confirm: true });
    try {
      const otherCookies = await sessionCookies(other.user!.email!);
      const peek = await fetch(`${base}/api/generate/${accepted.jobId}`, { headers: { cookie: otherCookies } });
      assert.equal(peek.status, 404);
      ok("another account gets 404 for this job (row-level security)");
    } finally {
      await admin.auth.admin.deleteUser(other.user!.id);
    }
  }

  console.log(`\n${passed} passed`);
} finally {
  await admin.auth.admin.deleteUser(userId);
  console.log("cleaned up the test user (projects, jobs and ledger cascade)");
}
