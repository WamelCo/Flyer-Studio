/**
 * The browser side of background generation (lib/generation/client.ts), against a fake
 * fetch: 202 → polled stages → result; failure with refunded balance; network blips;
 * the legacy inline response; giving up after the deadline.
 *   pnpm test:jobs
 */
import assert from "node:assert/strict";

import { ApiError } from "@/lib/api/client";
import { generateFlyer } from "@/lib/generation/client";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

type Reply = { status: number; body: unknown } | "offline";
let replies: Reply[] = [];
const requests: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push(`${init?.method ?? "GET"} ${String(input)}`);
  const next = replies.shift() ?? { status: 500, body: { error: "INTERNAL_ERROR", message: "no reply queued" } };
  if (next === "offline") throw new TypeError("fetch failed");
  return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;
// Poll instantly in tests.
globalThis.setTimeout = ((fn: () => void) => (queueMicrotask(fn), 0)) as unknown as typeof setTimeout;

const result = { jobId: "j1", projectId: "p1", format: "poster", docs: [{ version: 1 }], directions: [], rationale: "", source: "open-model", photoDownloads: [], balance: 95 };
const accepted = { status: 202, body: { jobId: "j1", status: "pending", balance: 95 } };

console.log("background generation (client)");
await test("202 → stages reported in order → the result", async () => {
  replies = [accepted, { status: 200, body: { status: "running", stage: "directing" } }, { status: 200, body: { status: "running", stage: "designing" } }, { status: 200, body: { status: "succeeded", stage: "done", result } }];
  requests.length = 0;
  const stages: string[] = [];
  let charged = 0;
  const out = await generateFlyer({ prompt: "Jazz", format: "poster" }, (s) => stages.push(s), (b) => (charged = b));
  assert.equal(out.projectId, "p1");
  assert.deepEqual(stages, ["directing", "designing", "done"]);
  assert.equal(charged, 95, "the charged balance is shown straight away");
  assert.equal(requests[0], "POST /api/generate");
  assert.ok(requests.slice(1).every((r) => r === "GET /api/generate/j1"));
});
await test("a failed job becomes an ApiError carrying the refunded balance", async () => {
  replies = [accepted, { status: 200, body: { status: "failed", stage: "designing", error: { code: "GENERATION_BLOCKED", message: "Could not generate design." }, balance: 100 } }];
  await assert.rejects(generateFlyer({ prompt: "x", format: "poster" }, () => undefined), (error: ApiError) => error.code === "GENERATION_BLOCKED" && error.details?.balance === 100);
});
await test("a few dropped polls are survived", async () => {
  replies = [accepted, "offline", { status: 503, body: { error: "NETWORK_ERROR", message: "x" } }, "offline", { status: 200, body: { status: "succeeded", stage: "done", result } }];
  assert.equal((await generateFlyer({ prompt: "x", format: "poster" }, () => undefined)).projectId, "p1");
});
await test("the in-request (pre-migration) response is returned as is", async () => {
  replies = [{ status: 200, body: result }];
  requests.length = 0;
  assert.equal((await generateFlyer({ prompt: "x", format: "poster" }, () => undefined)).jobId, "j1");
  assert.equal(requests.length, 1, "no polling");
});
await test("errors starting the job (credits, rate limit) surface unchanged", async () => {
  replies = [{ status: 429, body: { error: "RATE_LIMITED", message: "Give it a minute.", details: { retryAfter: 30 } } }];
  await assert.rejects(generateFlyer({ prompt: "x", format: "poster" }, () => undefined), (error: ApiError) => error.code === "RATE_LIMITED" && error.details?.retryAfter === 30);
});
await test("a job that never finishes times out with a helpful message", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => (now += 60_000);
  replies = [accepted, ...Array.from({ length: 10 }, () => ({ status: 200, body: { status: "running", stage: "designing" } }))];
  await assert.rejects(generateFlyer({ prompt: "x", format: "poster" }, () => undefined), (error: ApiError) => error.code === "GENERATION_TIMEOUT" && /Projects/.test(error.message));
  Date.now = realNow;
});

console.log(`\n${passed} passed`);
