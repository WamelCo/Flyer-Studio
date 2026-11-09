/**
 * The real migrations (packages/db/drizzle) and the package's own functions, against an
 * in-process Postgres (PGlite).
 *   pnpm test:db
 *
 * PGlite is single-connection, so "parallel" calls here are interleaved, not truly
 * concurrent; row-lock behaviour under real concurrency is covered by
 * scripts/test-credits-concurrency.mts against a running Postgres (DATABASE_URL).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import assert from "node:assert/strict";
import { join } from "node:path";

import { addCredits, deductCredits, fulfilPayment, getBalance, getProfileRow, useDb, type Db } from "../src/index";
import { TASKS } from "../src/maintenance";
import { check, hit } from "../src/rate-limit";
import * as schema from "../src/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: join(import.meta.dirname, "../drizzle") });
useDb(db as unknown as Db);

const userId = "00000000-0000-4000-8000-000000000001";
let passed = 0;

async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const sql = async <T,>(text: string, params: unknown[] = []) => (await client.query<T>(text, params)).rows;
const balance = () => getBalance(userId);
const add = (amount: number, key: string) => addCredits({ userId, amount, reason: "test", idempotencyKey: key });
const deduct = (amount: number, key: string) => deductCredits({ userId, amount, reason: "test", idempotencyKey: key });
const runTask = (name: string) => TASKS.find((t) => t.name === name)!.run();

console.log("credit ledger");

await test("a new user gets a Free profile with 0 credits", async () => {
  await sql(`insert into public."user" (id, name, email) values ($1, 'A', 'a@example.com')`, [userId]);
  const profile = await getProfileRow(userId);
  assert.equal(profile?.plan, "free");
  assert.equal(profile?.credits, 0);
  assert.equal(profile?.email, "a@example.com");
});

await test("the profile follows an email change", async () => {
  await sql(`update public."user" set email = 'new@example.com' where id = $1`, [userId]);
  assert.equal((await getProfileRow(userId))?.email, "new@example.com");
});

await test("add_credits is idempotent (a replayed payment does not double-add)", async () => {
  assert.equal(await add(2000, "paynow:p1"), 2000);
  assert.equal(await add(2000, "paynow:p1"), 2000);
  assert.equal(await balance(), 2000);
  assert.equal((await sql("select 1 from public.credit_ledger where idempotency_key = 'paynow:p1'")).length, 1);
});

await test("deduct_credits is idempotent on retry", async () => {
  assert.deepEqual(await deduct(100, "export:u:e1"), { ok: true, balance: 1900 });
  assert.deepEqual(await deduct(100, "export:u:e1"), { ok: true, balance: 1900 });
  assert.equal(await balance(), 1900);
});

await test("insufficient credits is a result, not a crash, and leaves no ledger row", async () => {
  assert.deepEqual(await deduct(999_999, "export:u:too-much"), { ok: false, balance: 1900 });
  assert.equal((await sql("select 1 from public.credit_ledger where idempotency_key = 'export:u:too-much'")).length, 0);
});

await test("two parallel exports against a balance that covers one: exactly one succeeds", async () => {
  await deduct(1896, "drain");
  assert.equal(await balance(), 4);
  const results = await Promise.all([deduct(4, "export:u:p1"), deduct(4, "export:u:p2")]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(await balance(), 0);
});

await test("the balance can never be written negative, even bypassing the functions", async () => {
  await assert.rejects(sql("update public.profiles set credits = -1 where id = $1", [userId]), /credits_non_negative/);
});

await test("non-positive amounts are rejected", async () => {
  await assert.rejects(add(0, "zero"), /INVALID_AMOUNT/);
  await assert.rejects(deduct(-5, "negative"), /INVALID_AMOUNT/);
});

console.log("jobs and rate limits");

await test("rate limits allow up to the limit in a window, then refuse; per key", async () => {
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await hit({ key: "generate:u", max: 3, windowSeconds: 60 }));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
  assert.deepEqual(results.map((r) => r.remaining), [2, 1, 0, 0]);
  assert.ok(results[3]!.retryAfter > 0 && results[3]!.retryAfter <= 60);
  assert.equal((await hit({ key: "generate:someone-else", max: 3, windowSeconds: 60 })).allowed, true);
  assert.equal((await check([{ key: "generate:u", max: 3, windowSeconds: 60 }])).blocked, true);
});

await test("a job that stops responding is failed and refunded once; a live one is left alone", async () => {
  await add(10, "topup-for-jobs");
  const before = await balance();
  await deduct(5, "generate:stale");
  await deduct(5, "generate:live");
  const jobs = await sql<{ id: string }>(
    `insert into public.generation_jobs (user_id, prompt, intent, format, status, credits_spent, stage, heartbeat_at)
     values ($1, 'stale job', 'event', 'poster', 'running', 5, 'designing', now() - interval '10 minutes'),
            ($1, 'live job',  'event', 'poster', 'running', 5, 'designing', now())
     returning id`,
    [userId],
  );
  const [stale, live] = jobs.map((j) => j.id);
  assert.equal(await runTask("fail-stale-generation-jobs"), 1);
  assert.equal(await balance(), before - 5, "the stale job's 5 credits came back");
  // The app may already have refunded with the same key: the sweep must not double it.
  await add(5, `refund:generate:${userId}:${stale}`);
  assert.equal(await balance(), before - 5);
  const rows = await sql<{ id: string; status: string; error_code: string | null }>("select id, status, error_code from public.generation_jobs where id = any($1)", [[stale, live]]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId[stale!]!.status, "failed");
  assert.equal(byId[stale!]!.error_code, "GENERATION_TIMEOUT");
  assert.equal(byId[live!]!.status, "running");
});

await test("job status, channel and export formats are checked", async () => {
  await assert.rejects(sql("insert into public.generation_jobs (user_id, prompt, intent, format, status) values ($1, 'x', 'event', 'poster', 'exploded')", [userId]), /generation_jobs_status_check/);
  await assert.rejects(sql("insert into public.generation_jobs (user_id, prompt, intent, format, channel) values ($1, 'x', 'event', 'poster', 'sms')", [userId]), /generation_jobs_channel_check/);
  const [project] = await sql<{ id: string }>("insert into public.flyer_projects (user_id, format, canvas) values ($1, 'poster', '{}') returning id", [userId]);
  for (const format of ["psd", "svg", "png-4k"]) {
    await sql("insert into public.exports (id, user_id, project_id, format, credits_spent, watermarked, storage_path) values (gen_random_uuid(), $1, $2, $3, 3, false, 'p')", [userId, project!.id, format]);
  }
  await assert.rejects(sql("insert into public.exports (id, user_id, project_id, format, credits_spent, watermarked, storage_path) values (gen_random_uuid(), $1, $2, 'ai', 3, false, 'p')", [userId, project!.id]), /exports_format_check/);
});

console.log("paynow passes");

const pay = async (plan: "pro" | "max", interval: "month" | "year", credits: number) =>
  (await sql<{ id: string }>("insert into public.payments (id, user_id, plan, billing_interval, amount, credits, status) values (gen_random_uuid(), $1, $2, $3, 19.99, $4, 'sent') returning id", [userId, plan, interval, credits]))[0]!.id;
const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);

await test("a paid pass grants its credits exactly once and runs a month", async () => {
  await sql("update public.profiles set plan = 'free', current_period_end = null where id = $1", [userId]);
  const before = await balance();
  const id = await pay("pro", "month", 2000);
  const first = await fulfilPayment(id, "PN-1");
  assert.equal(first.newlyPaid, true);
  assert.equal(first.balance, before + 2000);
  assert.equal(first.plan, "pro");
  assert.ok(Math.abs(days(new Date(), first.periodEnd) - 30) <= 1);
  const again = await fulfilPayment(id, "PN-1"); // a replayed notification or a second poll
  assert.equal(again.newlyPaid, false);
  assert.equal(await balance(), before + 2000, "no double grant");
  assert.deepEqual(await sql("select status, paynow_reference from public.payments where id = $1", [id]), [{ status: "paid", paynow_reference: "PN-1" }]);
});

await test("renewing early extends the pass from its end; switching plan starts a new one", async () => {
  const current = (await getProfileRow(userId))!.currentPeriodEnd!;
  const renewed = await fulfilPayment(await pay("pro", "month", 2000), null);
  assert.ok(Math.abs(days(current, renewed.periodEnd) - 30) <= 1, "a month added on top of the remaining time");
  const switched = await fulfilPayment(await pay("max", "year", 240000), null);
  assert.equal(switched.plan, "max");
  assert.ok(Math.abs(days(new Date(), switched.periodEnd) - 365) <= 1, "a different plan starts now, for a year");
});

await test("a lapsed pass returns to Free (credits stay); an active one is untouched", async () => {
  await sql("update public.profiles set plan = 'pro', current_period_end = now() - interval '1 hour' where id = $1", [userId]);
  const before = await balance();
  assert.equal(await runTask("expire-lapsed-passes"), 1);
  assert.equal((await getProfileRow(userId))?.plan, "free");
  assert.equal(await balance(), before);
  await sql("update public.profiles set plan = 'pro', current_period_end = now() + interval '1 day' where id = $1", [userId]);
  assert.equal(await runTask("expire-lapsed-passes"), 0);
});

console.log("upkeep and whatsapp");

await test("free projects older than a month are purged; paid ones are kept", async () => {
  await sql("update public.profiles set plan = 'free', current_period_end = null where id = $1", [userId]);
  await sql("update public.flyer_projects set updated_at = now() - interval '40 days' where user_id = $1", [userId]);
  // The touch trigger would reset updated_at on update; set it directly without the trigger.
  await sql("alter table public.flyer_projects disable trigger flyer_projects_touch_updated_at");
  await sql("update public.flyer_projects set updated_at = now() - interval '40 days' where user_id = $1", [userId]);
  await sql("alter table public.flyer_projects enable trigger flyer_projects_touch_updated_at");
  assert.equal(await runTask("purge-expired-free-projects"), 1);
});

await test("expired sessions, codes and old rate-limit windows are cleaned up", async () => {
  await sql(`insert into public.session (expires_at, token, user_id) values (now() - interval '1 day', 'old', $1), (now() + interval '1 day', 'live', $1)`, [userId]);
  await sql(`insert into public.verification (identifier, value, expires_at) values ('x', 'y', now() - interval '2 days')`);
  await sql(`insert into public.rate_limits (key, window_start, hits) values ('old', now() - interval '3 days', 1)`);
  assert.equal(await runTask("purge-expired-auth"), 2);
  assert.equal(await runTask("purge-rate-limits"), 1);
  assert.deepEqual(await sql("select token from public.session"), [{ token: "live" }]);
});

console.log("accounts by phone");

const phoneUser = async (id: string, phone: string) =>
  sql(`insert into public."user" (id, name, email, phone_number, phone_number_verified) values ($1, $2, $3, $2, true)`, [id, phone, `${phone.slice(1)}@phone.flyerstudio.invalid`]);
const free = async (id: string) => (await sql<{ free_flyers: number }>("select free_flyers from public.profiles where id = $1", [id]))[0]!.free_flyers;
const wa1 = "00000000-0000-4000-8000-0000000000a1";
const wa2 = "00000000-0000-4000-8000-0000000000a2";

await test("a new WhatsApp number gets 3 free flyers, once per number ever", async () => {
  await phoneUser(wa1, "+263771111111");
  assert.equal(await free(wa1), 3);
  // Deleted and created again: the number already had its welcome.
  await sql(`delete from public."user" where id = $1`, [wa1]);
  await phoneUser(wa1, "+263771111111");
  assert.equal(await free(wa1), 0);
  await sql(`delete from public."user" where id = $1`, [wa1]);
});

await test("an email account that verifies a never-seen number gets the welcome too (once)", async () => {
  await sql(`insert into public."user" (id, name, email) values ($1, 'E', 'e@example.com')`, [wa2]);
  assert.equal(await free(wa2), 0);
  await sql(`update public."user" set phone_number = '+263772222222', phone_number_verified = true where id = $1`, [wa2]);
  assert.equal(await free(wa2), 3);
  await sql(`update public."user" set name = 'E2', phone_number_verified = true where id = $1`, [wa2]);
  assert.equal(await free(wa2), 3, "no second grant on later updates");
});

await test("free flyers are spent atomically and never go below zero; a failed one comes back", async () => {
  const left = async () => Number((await sql<{ left: number }>("select public.use_free_flyer($1) as left", [wa2]))[0]!.left);
  assert.deepEqual([await left(), await left(), await left(), await left()], [2, 1, 0, -1]);
  await sql("select public.return_free_flyer($1)", [wa2]);
  assert.equal(await free(wa2), 1);
});

await test("chargeForFlyer: Free plan spends free flyers first, Pro spends credits first", async () => {
  const { chargeForFlyer } = await import("../src/credits");
  await add(10, "topup:charge"); // userId (Free plan) — has no free flyers: credits are used
  const paid = await chargeForFlyer({ userId, jobId: "00000000-0000-4000-8000-0000000000c1", cost: 5, preferFree: true });
  assert.equal(paid.ok && paid.free, false);
  const freeFirst = await chargeForFlyer({ userId: wa2, jobId: "00000000-0000-4000-8000-0000000000c2", cost: 5, preferFree: true });
  assert.ok(freeFirst.ok && freeFirst.free && freeFirst.freeLeft === 0);
  const none = await chargeForFlyer({ userId: wa2, jobId: "00000000-0000-4000-8000-0000000000c3", cost: 5, preferFree: true });
  assert.equal(none.ok, false);
});

await test("the stale-job sweep gives back a free flyer a dead job used", async () => {
  await sql("select public.return_free_flyer($1)", [wa2]);
  await sql("select public.use_free_flyer($1)", [wa2]);
  assert.equal(await free(wa2), 0);
  await sql(
    `insert into public.generation_jobs (user_id, prompt, intent, format, status, credits_spent, free_flyer, heartbeat_at)
     values ($1, 'dead free job', 'event', 'poster', 'running', 0, true, now() - interval '10 minutes')`,
    [wa2],
  );
  await runTask("fail-stale-generation-jobs");
  assert.equal(await free(wa2), 1);
});

await test("grant_pass: plan, period and credits once per key", async () => {
  const { grantPass } = await import("../src/credits");
  const before = (await getProfileRow(wa2))!.credits;
  const granted = await grantPass(wa2, "pro", "year", 24000, "grant:test:1");
  assert.equal(granted.plan, "pro");
  assert.ok(Math.abs(days(new Date(), granted.periodEnd) - 365) <= 1);
  assert.equal(granted.balance, before + 24000);
  const again = await grantPass(wa2, "pro", "month", 2000, "grant:test:1");
  assert.equal(again.balance, before + 24000, "same key: no second credit grant");
});

await test("merge_accounts: a WhatsApp account folds into a web account — projects, balances, pass, number", async () => {
  const web = "00000000-0000-4000-8000-0000000000b1";
  const wa = "00000000-0000-4000-8000-0000000000b2";
  await sql(`insert into public."user" (id, name, email) values ($1, 'Web', 'web@example.com')`, [web]);
  await phoneUser(wa, "+263773333333");
  await sql("select public.add_credits($1, 40, 'test', 'merge:topup')", [wa]);
  await sql("insert into public.flyer_projects (user_id, format, canvas) values ($1, 'poster', '{}')", [wa]);
  await sql("update public.profiles set plan = 'pro', current_period_end = now() + interval '20 days' where id = $1", [wa]);
  const { mergeAccounts } = await import("../src/credits");
  await mergeAccounts(wa, web);
  const [merged] = await sql<{ credits: number; free_flyers: number; plan: string }>("select credits, free_flyers, plan from public.profiles where id = $1", [web]);
  assert.deepEqual(merged, { credits: 40, free_flyers: 3, plan: "pro" });
  assert.equal((await sql("select 1 from public.flyer_projects where user_id = $1", [web])).length, 1);
  assert.deepEqual(await sql(`select phone_number, phone_number_verified from public."user" where id = $1`, [web]), [{ phone_number: "+263773333333", phone_number_verified: true }]);
  assert.equal((await sql(`select 1 from public."user" where id = $1`, [wa])).length, 0, "the WhatsApp account is gone");
  assert.equal((await sql<{ user_id: string }>("select user_id from public.free_flyer_grants where phone = '+263773333333'"))[0]!.user_id, web);
});

await test("merge_accounts the other way: a web (email) account folds into a WhatsApp account", async () => {
  const wa = "00000000-0000-4000-8000-0000000000d1";
  const web = "00000000-0000-4000-8000-0000000000d2";
  await phoneUser(wa, "+263774444444");
  await sql(`insert into public."user" (id, name, email, email_verified) values ($1, 'Web', 'tari@example.com', true)`, [web]);
  await sql("select public.add_credits($1, 25, 'test', 'merge2:topup')", [web]);
  await sql("insert into public.flyer_projects (user_id, format, canvas) values ($1, 'square', '{}')", [web]);
  const { mergeAccounts } = await import("../src/credits");
  await mergeAccounts(web, wa);
  // The app then gives the WhatsApp account the (now free) email address.
  await sql(`update public."user" set email = 'tari@example.com', email_verified = true where id = $1`, [wa]);
  const [account] = await sql<{ email: string; phone_number: string; credits: number; free_flyers: number }>(
    `select u.email, u.phone_number, p.credits, p.free_flyers from public."user" u join public.profiles p on p.id = u.id where u.id = $1`,
    [wa],
  );
  assert.deepEqual(account, { email: "tari@example.com", phone_number: "+263774444444", credits: 25, free_flyers: 3 });
  assert.equal((await sql("select 1 from public.flyer_projects where user_id = $1", [wa])).length, 1);
  assert.equal((await sql(`select 1 from public."user" where id = $1`, [web])).length, 0);
  assert.equal((await sql<{ email: string }>("select email from public.profiles where id = $1", [wa]))[0]!.email, "tari@example.com", "profile email follows");
});

await test("deleting a user removes everything they own", async () => {
  await sql(`delete from public."user" where id = $1`, [userId]);
  for (const table of ["profiles", "credit_ledger", "flyer_projects", "payments", "whatsapp_chats", "session"]) {
    const column = table === "profiles" ? "id" : "user_id";
    assert.equal((await sql(`select 1 from public.${table} where ${column} = $1`, [userId])).length, 0, table);
  }
});

console.log(`\n${passed} passed`);
await client.close();
