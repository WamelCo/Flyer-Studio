/**
 * Local Stripe webhooks without the Stripe CLI: polls your test-mode events and delivers
 * each one to the dev server, signed with STRIPE_WEBHOOK_SECRET exactly as Stripe would.
 *   pnpm stripe:webhooks                 forward new events while `pnpm dev` runs
 *   pnpm stripe:webhooks --replay        also deliver every event a second time and check
 *                                         the duplicate grants nothing (idempotency)
 *   pnpm stripe:webhooks --since=60      start from events in the last 60 minutes
 *   pnpm stripe:webhooks --once          deliver what's there and exit
 *
 * The first run generates a local signing secret into the root .env if none is set (the dev
 * server picks up the change on its own). Refuses live-mode keys.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";

const ENV_FILE = join(import.meta.dirname, "..", "..", "..", ".env");
const TYPES = ["checkout.session.completed", "invoice.paid", "customer.subscription.updated", "customer.subscription.deleted"];

const args = process.argv.slice(2);
const replay = args.includes("--replay");
const once = args.includes("--once");
const sinceMinutes = Number(args.find((a) => a.startsWith("--since="))?.split("=")[1] ?? 0);
const target = `${process.env.API_URL || "http://localhost:4000"}/api/webhooks/stripe`;

const key = process.env.STRIPE_SECRET_KEY;
if (!key) fail("STRIPE_SECRET_KEY is empty in the root .env.");
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) fail("Webhook forwarding only runs against Stripe test mode.");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(target).origin)) fail(`Refusing to forward to ${target}: local dev server only.`);

const secret = process.env.STRIPE_WEBHOOK_SECRET || createLocalSecret();
const stripe = new Stripe(key);
const delivered = new Set<string>();
let since = Math.floor(Date.now() / 1000) - sinceMinutes * 60;
let failures = 0;

console.log(`Forwarding Stripe test events to ${target}${replay ? " (each delivered twice)" : ""}. Ctrl+C to stop.`);

for (;;) {
  const events = await newEvents();
  for (const event of events) await deliver(event);
  if (once) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
process.exit(failures ? 1 : 0);

// ── Helpers ─────────────────────────────────────────────────────────────────

async function newEvents() {
  const found: Stripe.Event[] = [];
  for await (const event of stripe.events.list({ types: TYPES, created: { gte: since }, limit: 100 })) {
    if (!delivered.has(event.id)) found.push(event);
  }
  // The list is newest first; deliver in the order Stripe created them.
  return found.sort((a, b) => a.created - b.created);
}

async function deliver(event: Stripe.Event) {
  delivered.add(event.id);
  since = Math.max(since, event.created - 5);
  const first = await post(event);
  const line = `${new Date(event.created * 1000).toLocaleTimeString()}  ${event.type.padEnd(30)} ${event.id}  → ${first.status} ${first.summary}`;
  console.log(line);
  if (!replay || first.status !== 200) return;
  const second = await post(event);
  const ok = second.status === 200 && second.body?.duplicate === true;
  if (!ok) failures++;
  console.log(`${" ".repeat(10)}replay ${" ".repeat(23)} → ${second.status} ${second.summary} ${ok ? "✓ ignored as duplicate" : "✗ expected a duplicate"}`);
}

async function post(event: Stripe.Event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  try {
    const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.status !== 200) failures++;
    return { status: response.status, body, summary: body ? JSON.stringify(body) : "" };
  } catch (error) {
    failures++;
    return { status: 0, body: null, summary: `dev server unreachable (${(error as Error).message})` };
  }
}

function createLocalSecret() {
  const value = `whsec_${randomBytes(24).toString("base64url")}`;
  const text = readFileSync(ENV_FILE, "utf8");
  const line = /^STRIPE_WEBHOOK_SECRET=.*$/m;
  writeFileSync(ENV_FILE, line.test(text) ? text.replace(line, `STRIPE_WEBHOOK_SECRET=${value}`) : `${text.replace(/\s*$/, "\n")}STRIPE_WEBHOOK_SECRET=${value}\n`);
  console.log("Generated a local STRIPE_WEBHOOK_SECRET in the root .env. Restart `pnpm dev` so the API picks it up.");
  return value;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}
