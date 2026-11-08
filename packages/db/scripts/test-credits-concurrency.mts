/**
 * Real-concurrency check against a real Postgres (DATABASE_URL, migrated):
 * fires parallel deductions over separate connections and asserts the balance never
 * goes negative and exactly the affordable number succeed. Cleans up after itself.
 *
 *   pnpm test:db:concurrency
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Set DATABASE_URL (in the root .env) to a migrated database.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 10 });
const userId = randomUUID();

async function rpc(fn: "add_credits" | "deduct_credits", amount: number, key: string) {
  const { rows } = await pool.query<{ balance: number }>(`select ${fn}($1, $2, 'test', $3) as balance`, [userId, amount, key]);
  return rows[0]!.balance;
}

async function credits() {
  const { rows } = await pool.query<{ credits: number }>("select credits from profiles where id = $1", [userId]);
  return rows[0]!.credits;
}

try {
  await pool.query(`insert into "user" (id, email) values ($1, $2)`, [userId, `concurrency-${userId}@example.test`]);
  await pool.query("insert into profiles (id, email) values ($1, $2)", [userId, `concurrency-${userId}@example.test`]);
  assert.equal(await credits(), 0, "new profiles start with 0 credits");

  await rpc("add_credits", 10, `test:${randomUUID()}`);

  // 10 credits, 8 parallel exports of 4 credits: exactly 2 can succeed.
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => rpc("deduct_credits", 4, `export:${randomUUID()}`)));
  const succeeded = attempts.filter((attempt) => attempt.status === "fulfilled").length;
  const insufficient = attempts.filter(
    (attempt) => attempt.status === "rejected" && String(attempt.reason).includes("INSUFFICIENT_CREDITS"),
  ).length;

  const after = await credits();
  console.log({ succeeded, insufficient, balance: after });
  assert.equal(succeeded, 2);
  assert.equal(insufficient, 6);
  assert.equal(after, 2);

  // Same idempotency key fired twice in parallel: charged once.
  const key = `export:${randomUUID()}`;
  await Promise.all([rpc("deduct_credits", 1, key), rpc("deduct_credits", 1, key)]);
  assert.equal(await credits(), 1);
  console.log("✓ parallel deductions never overdraw; duplicate keys charge once");
} finally {
  await pool.query(`delete from "user" where id = $1`, [userId]);
  await pool.end();
}
