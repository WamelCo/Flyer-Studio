/**
 * Exercises the credit ledger SQL against an in-process Postgres (PGlite).
 *   pnpm test:db
 *
 * Runs every Prisma migration in order, unmodified — no database server needed.
 * PGlite is single-connection, so "parallel" calls here are interleaved, not truly
 * concurrent; row-lock behaviour under real concurrency is covered by
 * scripts/test-credits-concurrency.mts against a real Postgres (pnpm test:db:concurrency).
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrations = join(import.meta.dirname, "..", "prisma", "migrations");
const folders = readdirSync(migrations, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (!folders.some((name) => name.endsWith("_init"))) {
  throw new Error("The init migration is missing. Run `pnpm --filter @flyer/db db:init-sql` first.");
}

const db = new PGlite();
for (const folder of folders) await db.exec(readFileSync(join(migrations, folder, "migration.sql"), "utf8"));

const userId = "00000000-0000-4000-8000-000000000001";
let passed = 0;

async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function balance() {
  const { rows } = await db.query<{ credits: number }>("select credits from profiles where id = $1", [userId]);
  return rows[0]!.credits;
}

async function rpc(fn: "add_credits" | "deduct_credits", amount: number, key: string) {
  const { rows } = await db.query<{ balance: number }>(`select ${fn}($1, $2, 'test', $3) as balance`, [userId, amount, key]);
  return rows[0]!.balance;
}

console.log("credit ledger");

await test("a new profile is Free with 0 credits", async () => {
  await db.query(`insert into "user" (id, email) values ($1, 'a@example.com')`, [userId]);
  await db.query("insert into profiles (id, email) values ($1, 'a@example.com')", [userId]);
  const { rows } = await db.query<{ plan: string; credits: number }>("select plan, credits from profiles where id = $1", [userId]);
  assert.deepEqual(rows[0], { plan: "free", credits: 0 });
});

await test("add_credits is idempotent (invoice.paid replay does not double-add)", async () => {
  assert.equal(await rpc("add_credits", 2000, "invoice:in_123"), 2000);
  assert.equal(await rpc("add_credits", 2000, "invoice:in_123"), 2000);
  assert.equal(await balance(), 2000);
  const { rows } = await db.query("select 1 from credit_ledger where idempotency_key = 'invoice:in_123'");
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
  const { rows } = await db.query("select 1 from credit_ledger where idempotency_key = 'export:u:too-much'");
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

await test("the balance can never be written negative, even bypassing the functions", async () => {
  await assert.rejects(db.query("update profiles set credits = -1 where id = $1", [userId]), /credits_non_negative/);
});

await test("non-positive amounts are rejected", async () => {
  await assert.rejects(rpc("add_credits", 0, "zero"), /INVALID_AMOUNT/);
  await assert.rejects(rpc("deduct_credits", -5, "negative"), /INVALID_AMOUNT/);
});

await test("crediting an unknown user fails and leaves no ledger row", async () => {
  await assert.rejects(
    db.query("select add_credits('missing-user', 5, 'test', 'ghost')"),
    /PROFILE_NOT_FOUND|foreign key/,
  );
  const { rows } = await db.query("select 1 from credit_ledger where idempotency_key = 'ghost'");
  assert.equal(rows.length, 0);
});

await test("retention purges Free projects idle for 30 days, keeps recent ones", async () => {
  const canvas = JSON.stringify({ format: "poster", nodes: [] });
  await db.query(
    `insert into flyer_projects (id, user_id, format, canvas, updated_at) values
       ('00000000-0000-4000-8000-0000000000a1', $1, 'poster', $2, now() - interval '31 days'),
       ('00000000-0000-4000-8000-0000000000a2', $1, 'poster', $2, now())`,
    [userId, canvas],
  );
  const { rows } = await db.query<{ deleted: number }>("select purge_expired_free_projects() as deleted");
  assert.equal(rows[0]!.deleted, 1);
  const left = await db.query<{ id: string }>("select id from flyer_projects where user_id = $1", [userId]);
  assert.deepEqual(left.rows.map((row) => row.id), ["00000000-0000-4000-8000-0000000000a2"]);
});

console.log(`\n${passed} passed`);
await db.close();
