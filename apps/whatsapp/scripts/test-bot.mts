/**
 * The WhatsApp conversation end to end — real migrations in PGlite, a recording channel
 * instead of WhatsApp, and a fake generator (no AI calls, no money).
 *   pnpm test:whatsapp
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import assert from "node:assert/strict";
import { join } from "node:path";

import type { RunOutcome } from "@flyer/ai/jobs";
import type { GenerationInput } from "@flyer/ai/pipeline";
import { phoneAccount } from "@flyer/auth/accounts";
import { addCredits, getBalance, returnFreeFlyer, useDb, type Db } from "@flyer/db";
import * as schema from "@flyer/db/schema";
import type { FlyerDoc } from "@flyer/design/canvas/types";

import { createBot, formatFrom } from "../src/bot";
import type { Incoming } from "../src/channel";
import { createServer } from "../src/server";
import { messageId } from "../src/whatsapp";

delete process.env.PAYNOW_INTEGRATION_ID;
delete process.env.PAYNOW_INTEGRATION_KEY;
process.env.NEXT_PUBLIC_SITE_URL = "https://flyers.test";

const client = new PGlite();
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: join(import.meta.dirname, "../../../packages/db/drizzle") });
useDb(db as unknown as Db);

const A = "+263771234567"; // says hi first
const B = "+263772345678"; // first message is already a flyer
const C = "+263773456789"; // a free flyer that fails
const accountOf = async (phone: string) =>
  (await client.query<{ id: string; free_flyers: number; credits: number; plan: string }>(
    `select u.id, p.free_flyers, p.credits, p.plan from public."user" u join public.profiles p on p.id = u.id where u.phone_number = $1`,
    [phone],
  )).rows[0];

// ── fakes ───────────────────────────────────────────────────────────────────
const sent: { chatId: string; text?: string; caption?: string }[] = [];
const rendered: boolean[] = [];
const generated: (GenerationInput & { balance: number })[] = [];
let failNext = false;
let failImages = false;

const doc = (n: number) => ({ width: 1080, height: 1350, format: "poster", nodes: [], background: `#00000${n}` }) as unknown as FlyerDoc;

const bot = createBot({
  channel: {
    sendText: async (chatId, text) => void sent.push({ chatId, text }),
    sendImage: async (chatId, _png, caption) => {
      if (failImages) throw new Error("upload failed: media entry was not created");
      sent.push({ chatId, caption });
    },
  },
  render: async (_doc, watermark) => {
    rendered.push(watermark);
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  },
  // Stands in for createJob + runJob, including what runJob gives back when a job fails.
  generate: async (input): Promise<RunOutcome> => {
    generated.push(input);
    await client.query(
      "insert into public.generation_jobs (id, user_id, prompt, intent, format, channel, credits_spent, free_flyer) values ($1, $2, $3, 'event', $4, $5, $6, $7)",
      [input.jobId, input.userId, input.prompt, input.format, input.channel, input.cost, input.freeFlyer ?? false],
    );
    if (failNext) {
      failNext = false;
      if (input.cost) await addCredits({ userId: input.userId, amount: input.cost, reason: "refund:generate", idempotencyKey: `refund:generate:${input.userId}:${input.jobId}` });
      if (input.freeFlyer) await returnFreeFlyer(input.userId);
      return { ok: false, code: "GENERATION_FAILED", message: "We couldn't design this flyer. Your credits were returned — please try again.", balance: null };
    }
    const docs = [doc(1), doc(2), doc(3)];
    const [project] = (await client.query<{ id: string }>("insert into public.flyer_projects (user_id, format, canvas, generation_id) values ($1, $2, $3, $4) returning id", [input.userId, input.format, JSON.stringify(docs[0]), input.jobId])).rows;
    const response = { jobId: input.jobId, projectId: project!.id, format: input.format, docs, directions: docs.map((_, i) => ({ layout: `Layout ${i + 1}`, palette: "Sunset", type: "Bold" })), rationale: "", source: "rules" as const, photoDownloads: [[], [], []] };
    await client.query("update public.generation_jobs set status = 'succeeded', project_id = $2, result = $3 where id = $1", [input.jobId, project!.id, JSON.stringify(response)]);
    return { ok: true, response };
  },
});

let n = 0;
let keepLimits = false;
const say = async (body: string, from = A, kind: Incoming["kind"] = "text", id = `msg-${++n}`) => {
  // Fixed one-minute windows would make a long suite flaky: start every message fresh.
  if (!keepLimits) await client.query("delete from public.rate_limits");
  const before = sent.length;
  await bot.handle({ id, chatId: `${from.slice(1)}@c.us`, phone: from, body, kind });
  return sent.slice(before);
};
const texts = (messages: { text?: string; caption?: string }[]) => messages.map((m) => m.text ?? m.caption ?? "").join("\n");

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("whatsapp bot");

await test("hi from a new number creates its account on the spot, with 3 free flyers", async () => {
  assert.equal(await accountOf(A), undefined);
  const replies = await say("Hi");
  const account = await accountOf(A);
  assert.ok(account, "account created");
  assert.equal(account.free_flyers, 3);
  assert.equal(account.plan, "free");
  assert.match(texts(replies), /Your account is ready — it's this WhatsApp number/);
  assert.match(texts(replies), /first 3 flyers are free/);
  assert.equal(generated.length, 0);
});

await test("the same message delivered twice is answered once; hi again shows the menu", async () => {
  assert.equal((await say("balance", A, "text", "dup-1")).length, 1);
  assert.equal((await say("balance", A, "text", "dup-1")).length, 0);
  assert.match(texts(await say("hello")), /You have 3 free flyers left/);
});

await test("a first message that already describes a flyer creates the account and starts it", async () => {
  const replies = await say("Braai fundraiser at Hatfield Primary, Saturday 2pm, $5 a plate", B);
  assert.equal((await accountOf(B))?.free_flyers, 2);
  assert.equal(generated.length, 1);
  assert.equal(generated[0]!.freeFlyer, true);
  assert.equal(generated[0]!.cost, 0);
  assert.equal(generated[0]!.ideogram, false, "free flyers never buy a paid image");
  assert.match(texts(replies), /Welcome to Flyer Studio/);
  assert.equal(replies.filter((m) => m.caption).length, 3);
  assert.match(texts(replies), /You have 2 free flyers left/);
});

await test("free flyers are watermarked; after three, it asks them to buy", async () => {
  rendered.length = 0;
  for (const prompt of ["Grand opening of Mbare fresh market, 1 December", "Youth football tournament on Friday at 3pm", "Gospel concert at City Hall on Saturday"]) await say(prompt);
  assert.deepEqual(rendered, Array(9).fill(true));
  assert.equal((await accountOf(A))?.free_flyers, 0);
  const runs = generated.length;
  assert.match(texts(await say("One more flyer for the jazz night at the Book Cafe")), /used your free flyers.*buy/s);
  assert.equal(generated.length, runs, "nothing generated without a free flyer or credits");
});

await test("Pro: credits pay, no watermark, Ideogram allowed; Status means 9:16", async () => {
  const id = (await accountOf(A))!.id;
  await addCredits({ userId: id, amount: 12, reason: "test", idempotencyKey: "test:topup" });
  await client.query("update public.profiles set plan = 'pro', current_period_end = now() + interval '30 days' where id = $1", [id]);
  rendered.length = 0;
  const replies = await say("Flyer for my WhatsApp status: jazz night Friday at the Book Cafe");
  const run = generated.at(-1)!;
  assert.deepEqual([run.cost, run.freeFlyer, run.ideogram, run.format], [5, false, true, "story"]);
  assert.deepEqual(rendered, [false, false, false]);
  assert.match(texts(replies), /You have 7 credits/);
});

await test("two flyer requests sent at once start (and charge for) one flyer", async () => {
  const id = (await accountOf(A))!.id;
  const before = { runs: generated.length, balance: await getBalance(id) };
  const [a, b] = await Promise.all([say("Gospel concert at City Hall on Saturday night"), say("Gospel concert at City Hall on Sunday night")]);
  assert.equal(generated.length, before.runs + 1);
  assert.equal(await getBalance(id), before.balance - 5);
  assert.match(texts([...a, ...b]), /Still working on your last flyer/);
});

await test("2 opens the second design as a new project; 1 opens the saved one; the web uses the same account", async () => {
  const two = texts(await say("2"));
  assert.match(two, /Design 2 is ready to edit/);
  assert.match(two, /Sign in there with this WhatsApp number/);
  const link = two.match(/editor\/([0-9a-f-]{36})/)![1];
  const [project] = (await client.query<{ canvas: { background: string } }>("select canvas from public.flyer_projects where id = $1", [link])).rows;
  assert.equal(project!.canvas.background, "#000002");
  const [job] = (await client.query<{ project_id: string }>("select project_id from public.generation_jobs where id = $1", [generated.at(-1)!.jobId])).rows;
  assert.ok(texts(await say("1")).includes(`/editor/${job!.project_id}`));
  // A web sign-in with this number (Better Auth looks users up by phone) lands in the same account.
  const again = await phoneAccount(A);
  assert.deepEqual([again.id, again.created], [(await accountOf(A))!.id, false]);
});

await test("a failed free flyer is given back; a failed paid one is refunded", async () => {
  await say("Hi", C);
  failNext = true;
  assert.match(texts(await say("Baby shower for Rudo, 14 December, Borrowdale", C)), /free flyer is still yours/);
  assert.equal((await accountOf(C))?.free_flyers, 3);
  const id = (await accountOf(A))!.id;
  await addCredits({ userId: id, amount: 10, reason: "test", idempotencyKey: "test:topup-fail" });
  const before = await getBalance(id);
  failNext = true;
  assert.match(texts(await say("Workshop on small business bookkeeping next Tuesday")), /credits were returned/);
  assert.equal(await getBalance(id), before);
});

await test("when WhatsApp can't upload the pictures, the designs still arrive as an editor link", async () => {
  const id = (await accountOf(A))!.id;
  await addCredits({ userId: id, amount: 5, reason: "test", idempotencyKey: "test:topup-upload" });
  failImages = true;
  const replies = texts(await say("Netball tournament at Gwanzura Stadium next Saturday"));
  failImages = false;
  assert.match(replies, /couldn't upload the pictures just now/);
  assert.match(replies, /https:\/\/flyers\.test\/editor\/[0-9a-f-]{36}/);
  assert.match(texts(await say("2")), /Design 2 is ready to edit/);
});

await test("buy lists the passes; choosing one without Paynow configured says so", async () => {
  assert.match(texts(await say("buy")), /\*pro month\* — Pro, 1 month: \$19\.99/);
  assert.match(texts(await say("Pro month")), /Payments aren't set up yet/);
});

await test("a number over its message limit is ignored, not answered", async () => {
  keepLimits = true;
  await client.query("delete from public.rate_limits");
  await client.query("insert into public.rate_limits (key, window_start, hits) values ($1, to_timestamp(floor(extract(epoch from now()) / 60) * 60), 12)", [`whatsapp:min:${A}`]);
  assert.equal((await say("balance")).length, 0);
  keepLimits = false;
});

await test("media gets a text-only notice; short text gets the menu", async () => {
  assert.match(texts(await say("", A, "media")), /only read text/);
  assert.match(texts(await say("ok thanks")), /Describe the flyer/);
});

await test("formats: Status and story mean 9:16, square means 1:1, else a poster", async () => {
  assert.equal(formatFrom("flyer for my WhatsApp status"), "story");
  assert.equal(formatFrom("an instagram post, square please"), "square");
  assert.equal(formatFrom("Sunday service"), "poster");
});

await test("redelivered messages without WhatsApp's serialized id still get a stable id", async () => {
  const base = { from: "263771234567@c.us", timestamp: 1, body: "hi" };
  assert.equal(messageId({ ...base, id: { _serialized: "true_x_ABC" } }), "true_x_ABC");
  assert.equal(messageId({ ...base, id: { id: "ABC", remote: "263771234567@c.us" } }), "263771234567@c.us_ABC");
  assert.equal(messageId({ ...base, id: null }), messageId({ ...base, id: null }));
});

console.log("internal api");

await test("send needs the shared secret, a valid number and a connected WhatsApp", async () => {
  const delivered: string[] = [];
  const state = { status: "ready" as const, qr: null, number: "+263770000000" };
  const app = createServer({ state, sendToNumber: async (to, text) => void delivered.push(`${to}:${text}`) }, { INTERNAL_API_SECRET: "s3cret" } as NodeJS.ProcessEnv);
  const post = (body: unknown, token = "s3cret") =>
    app.request("/internal/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({ to: "+263771234567", text: "123456 is your code" }, "wrong")).status, 401);
  assert.equal((await post({ to: "0771234567", text: "x" })).status, 400);
  assert.equal((await post({ to: "+263771234567", text: "123456 is your code" })).status, 200);
  assert.deepEqual(delivered, ["+263771234567:123456 is your code"]);
  assert.deepEqual(await (await app.request("/internal/status", { headers: { Authorization: "Bearer s3cret" } })).json(), { state: "ready", number: "+263770000000" });
  assert.equal((await app.request("/qr?token=nope")).status, 404);
  assert.equal((await app.request("/health")).status, 200);
});

console.log(`\n${passed} passed`);
await client.close();
process.exit(0);
