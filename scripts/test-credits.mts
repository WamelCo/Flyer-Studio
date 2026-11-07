/**
 * Exercises the credit ledger SQL against an in-process Postgres (PGlite).
 *   pnpm test:db
 *
 * Supabase's auth schema and roles are stubbed so the real migration runs unmodified.
 * PGlite is single-connection, so "parallel" calls here are interleaved, not truly
 * concurrent; row-lock behaviour under real concurrency is covered by
 * scripts/test-credits-concurrency.mts against a running Supabase database.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");
const migration = readFileSync(join(root, "supabase/migrations/20261105000000_init.sql"), "utf8");

const db = new PGlite();

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);
await db.exec(migration);

const userId = "00000000-0000-4000-8000-000000000001";
let passed = 0;

async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function balance() {
  const { rows } = await db.query<{ credits: number }>("select credits from public.profiles where id = $1", [userId]);
  return rows[0]!.credits;
}

async function rpc(fn: "add_credits" | "deduct_credits", amount: number, key: string) {
  const { rows } = await db.query<{ balance: number }>(
    `select public.${fn}($1, $2, 'test', $3) as balance`,
    [userId, amount, key],
  );
  return rows[0]!.balance;
}

console.log("credit ledger");

await test("signup trigger creates a Free profile with 0 credits", async () => {
  await db.query("insert into auth.users (id, email) values ($1, 'a@example.com')", [userId]);
  const { rows } = await db.query<{ plan: string; credits: number }>(
    "select plan, credits from public.profiles where id = $1",
    [userId],
  );
  assert.deepEqual(rows[0], { plan: "free", credits: 0 });
});

await test("add_credits is idempotent (invoice.paid replay does not double-add)", async () => {
  assert.equal(await rpc("add_credits", 2000, "invoice:in_123"), 2000);
  assert.equal(await rpc("add_credits", 2000, "invoice:in_123"), 2000);
  assert.equal(await balance(), 2000);
  const { rows } = await db.query("select 1 from public.credit_ledger where idempotency_key = 'invoice:in_123'");
  assert.equal(rows.length, 1);
});

await test("checkout.session.completed and invoice.paid for the same invoice grant once", async () => {
  await rpc("add_credits", 100, "invoice:in_first");
  await rpc("add_credits", 100, "invoice:in_first");
  assert.equal(await balance(), 2100);
});

await test("deduct_credits is idempotent on retry", async () => {
  assert.equal(await rpc("deduct_credits", 100, "export:u:e1"), 2000);
  assert.equal(await rpc("deduct_credits", 100, "export:u:e1"), 2000);
  assert.equal(await balance(), 2000);
});

await test("insufficient credits raises and leaves no ledger row", async () => {
  await assert.rejects(rpc("deduct_credits", 999_999, "export:u:too-much"), /INSUFFICIENT_CREDITS/);
  assert.equal(await balance(), 2000);
  const { rows } = await db.query("select 1 from public.credit_ledger where idempotency_key = 'export:u:too-much'");
  assert.equal(rows.length, 0);
});

await test("two parallel exports against a balance that covers one: exactly one succeeds", async () => {
  await rpc("deduct_credits", 1996, "drain");
  assert.equal(await balance(), 4);
  const results = await Promise.allSettled([rpc("deduct_credits", 4, "export:u:p1"), rpc("deduct_credits", 4, "export:u:p2")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(await balance(), 0);
});

await test("the balance can never be written negative, even bypassing the RPC", async () => {
  await assert.rejects(db.query("update public.profiles set credits = -1 where id = $1", [userId]), /credits_non_negative/);
});

await test("non-positive amounts are rejected", async () => {
  await assert.rejects(rpc("add_credits", 0, "zero"), /INVALID_AMOUNT/);
  await assert.rejects(rpc("deduct_credits", -5, "negative"), /INVALID_AMOUNT/);
});

await test("browser roles cannot execute the credit RPCs", async () => {
  const { rows } = await db.query<{ anon: boolean; authed: boolean; service: boolean }>(`
    select has_function_privilege('anon', 'public.add_credits(uuid, integer, text, text)', 'execute') as anon,
           has_function_privilege('authenticated', 'public.deduct_credits(uuid, integer, text, text)', 'execute') as authed,
           has_function_privilege('service_role', 'public.deduct_credits(uuid, integer, text, text)', 'execute') as service
  `);
  assert.deepEqual(rows[0], { anon: false, authed: false, service: true });
});

// ── Phase 0: background jobs and rate limits ─────────────────────────────────
// PGlite has no pg_cron: stub just enough of it for the migration's schedule calls.
await db.exec(`
  create schema cron;
  create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns integer language sql
    as $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
  create function cron.unschedule(p_jobid integer) returns boolean language sql
    as $$ delete from cron.job where jobid = p_jobid returning true $$;
`);
// PGlite cannot install pg_cron; the schema stub above stands in for it.
const phase0 = readFileSync(join(root, "supabase/migrations/20261107000000_phase0_jobs_rate_limits.sql"), "utf8").replace(/^create extension if not exists pg_cron;$/m, "");
await db.exec(phase0);
await db.exec(phase0); // safe to re-run

console.log("jobs and rate limits");

await test("the migration schedules the stale-job sweeper and the rate-limit purge exactly once", async () => {
  const { rows } = await db.query<{ jobname: string }>("select jobname from cron.job order by jobname");
  assert.deepEqual(rows.map((r) => r.jobname), ["fail-stale-generation-jobs", "purge-rate-limits"]);
});

await test("rate_limit_hit allows up to the limit in a window, then refuses", async () => {
  const results: { allowed: boolean; remaining: number }[] = [];
  for (let i = 0; i < 4; i++) {
    results.push((await db.query<{ allowed: boolean; remaining: number }>("select allowed, remaining from public.rate_limit_hit('generate:u', 3, 60)")).rows[0]!);
  }
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
  assert.deepEqual(results.map((r) => r.remaining), [2, 1, 0, 0]);
  const other = (await db.query<{ allowed: boolean }>("select allowed from public.rate_limit_hit('generate:someone-else', 3, 60)")).rows[0]!;
  assert.equal(other.allowed, true, "limits are per key");
});

await test("browser roles cannot call rate_limit_hit or the sweeper", async () => {
  const { rows } = await db.query<{ authed: boolean; sweeper: boolean; service: boolean }>(`
    select has_function_privilege('authenticated', 'public.rate_limit_hit(text, integer, integer)', 'execute') as authed,
           has_function_privilege('authenticated', 'public.fail_stale_generation_jobs()', 'execute') as sweeper,
           has_function_privilege('service_role', 'public.rate_limit_hit(text, integer, integer)', 'execute') as service
  `);
  assert.deepEqual(rows[0], { authed: false, sweeper: false, service: true });
});

await test("a job that stops responding is failed and refunded once; a live one is left alone", async () => {
  await rpc("add_credits", 10, "topup-for-jobs");
  const before = await balance();
  await rpc("deduct_credits", 5, "generate:stale");
  await rpc("deduct_credits", 5, "generate:live");
  const { rows: jobs } = await db.query<{ id: string }>(`
    insert into public.generation_jobs (user_id, prompt, intent, format, status, credits_spent, stage, heartbeat_at)
    values ($1, 'stale job', 'event', 'poster', 'running', 5, 'designing', now() - interval '10 minutes'),
           ($1, 'live job',  'event', 'poster', 'running', 5, 'designing', now())
    returning id`, [userId]);
  const [stale, live] = jobs.map((j) => j.id);

  const swept = await db.query<{ n: number }>("select public.fail_stale_generation_jobs() as n");
  assert.equal(swept.rows[0]!.n, 1);
  assert.equal(await balance(), before - 5, "the stale job's 5 credits came back");

  // The app may already have refunded with the same key: the sweeper must not double it.
  await rpc("add_credits", 5, `refund:generate:${userId}:${stale}`);
  assert.equal(await balance(), before - 5);

  const { rows } = await db.query<{ id: string; status: string; error_code: string | null }>("select id, status, error_code from public.generation_jobs where id = any($1)", [[stale, live]]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId[stale!]!.status, "failed");
  assert.equal(byId[stale!]!.error_code, "GENERATION_TIMEOUT");
  assert.equal(byId[live!]!.status, "running");
});

await test("job status accepts running; unknown statuses are rejected", async () => {
  await assert.rejects(
    db.query("insert into public.generation_jobs (user_id, prompt, intent, format, status) values ($1, 'x', 'event', 'poster', 'exploded')", [userId]),
    /generation_jobs_status_check/,
  );
});

console.log(`\n${passed} passed`);
await db.close();
