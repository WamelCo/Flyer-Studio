/**
 * Real-concurrency check against a running Supabase (local or a test project):
 * fires parallel deductions through PostgREST — separate DB connections — and asserts
 * the balance never goes negative and exactly the affordable number succeed.
 *
 *   node --env-file=.env.local scripts/test-credits-concurrency.mts
 */
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email: `concurrency-${randomUUID()}@example.test`,
  email_confirm: true,
});
if (createError || !created.user) throw createError;
const userId = created.user.id;

try {
  const { data: profile } = await admin.from("profiles").select("credits").eq("id", userId).single();
  assert.equal(profile?.credits, 0, "new profiles start with 0 credits");

  await admin.rpc("add_credits", { p_user_id: userId, p_amount: 10, p_reason: "test", p_idempotency_key: `test:${randomUUID()}` });

  // 10 credits, 8 parallel exports of 4 credits: exactly 2 can succeed.
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      admin.rpc("deduct_credits", { p_user_id: userId, p_amount: 4, p_reason: "export:test", p_idempotency_key: `export:${randomUUID()}` }),
    ),
  );
  const succeeded = attempts.filter((attempt) => !attempt.error).length;
  const insufficient = attempts.filter((attempt) => attempt.error?.message.includes("INSUFFICIENT_CREDITS")).length;

  const { data: after } = await admin.from("profiles").select("credits").eq("id", userId).single();
  console.log({ succeeded, insufficient, balance: after?.credits });
  assert.equal(succeeded, 2);
  assert.equal(insufficient, 6);
  assert.equal(after?.credits, 2);

  // Same idempotency key fired twice in parallel: charged once.
  const key = `export:${randomUUID()}`;
  await Promise.all([
    admin.rpc("deduct_credits", { p_user_id: userId, p_amount: 1, p_reason: "export:test", p_idempotency_key: key }),
    admin.rpc("deduct_credits", { p_user_id: userId, p_amount: 1, p_reason: "export:test", p_idempotency_key: key }),
  ]);
  const { data: final } = await admin.from("profiles").select("credits").eq("id", userId).single();
  assert.equal(final?.credits, 1);
  console.log("✓ parallel deductions never overdraw; duplicate keys charge once");
} finally {
  await admin.auth.admin.deleteUser(userId);
}
