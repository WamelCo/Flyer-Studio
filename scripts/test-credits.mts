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

console.log(`\n${passed} passed`);
await db.close();
