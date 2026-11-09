/**
 * The credit guarantees under real concurrency: many connections deducting at once against a
 * running Postgres (DATABASE_URL — e.g. `docker compose up -d postgres` and `pnpm db:migrate`).
 *   pnpm --filter @flyer/db exec tsx scripts/test-credits-concurrency.mts
 * Creates a throwaway user and deletes it afterwards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";

const envFile = resolve(import.meta.dirname, "../../../.env.local");
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const userId = randomUUID();
const deduct = (amount: number, key: string) =>
  pool.query<{ balance: number }>("select public.deduct_credits($1, $2, 'export:test', $3) as balance", [userId, amount, key]);

try {
  await pool.query(`insert into public."user" (id, name, email) values ($1, 'Concurrency test', $2)`, [userId, `${userId}@test.invalid`]);
  await pool.query("select public.add_credits($1, 10, 'test', $2)", [userId, `test:${randomUUID()}`]);

  // 20 connections race to spend 4 credits each from a balance of 10: exactly two may win.
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => deduct(4, `export:${randomUUID()}`)));
  const won = results.filter((r) => r.status === "fulfilled").length;
  const refused = results.filter((r) => r.status === "rejected" && /INSUFFICIENT_CREDITS/.test(String(r.reason))).length;
  assert.equal(won, 2, "exactly two deductions fit in the balance");
  assert.equal(refused, 18);
  const { rows } = await pool.query<{ credits: number }>("select credits from public.profiles where id = $1", [userId]);
  assert.equal(rows[0]!.credits, 2);
  console.log("  ✓ 20 parallel deductions never overdraw (2 succeeded, 18 refused)");

  // The same idempotency key sent twice at once is charged once.
  const key = `export:${randomUUID()}`;
  await Promise.all([deduct(1, key), deduct(1, key)]);
  const after = await pool.query<{ credits: number }>("select credits from public.profiles where id = $1", [userId]);
  assert.equal(after.rows[0]!.credits, 1);
  console.log("  ✓ a duplicated request is charged once");
} finally {
  await pool.query(`delete from public."user" where id = $1`, [userId]);
  await pool.end();
}
