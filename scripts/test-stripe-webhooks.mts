/**
 * Stripe billing end to end in test mode, against the running dev server.
 *   pnpm test:stripe        (needs `pnpm dev` running and `pnpm stripe:setup` done)
 *
 * Creates a throwaway user and a Pro subscription paid with Stripe's test card, then
 * delivers every resulting Stripe event to /api/webhooks/stripe TWICE, signed exactly as
 * Stripe signs them. Checks: the plan is provisioned, credits land exactly once despite
 * the replays (and despite invoice.paid + subscription events overlapping), and
 * cancelling drops the account to Free. Cleans up the Stripe customer and the user.
 * Refuses live-mode keys.
 */
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";

import { creditsForInvoice } from "../lib/stripe/plans.ts";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
};
const key = env("STRIPE_SECRET_KEY");
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) throw new Error("Refusing to run against a live Stripe key.");
const secret = env("STRIPE_WEBHOOK_SECRET");
const price = env("STRIPE_PRICE_PRO_MONTHLY");
const target = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/webhooks/stripe`;
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(target)) throw new Error(`Refusing to post to ${target}: local dev server only.`);

const stripe = new Stripe(key);
const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const TYPES = ["checkout.session.completed", "invoice.paid", "customer.subscription.updated", "customer.subscription.deleted"];

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const { data: created, error: createError } = await admin.auth.admin.createUser({ email: `stripe-test-${randomUUID()}@example.test`, email_confirm: true });
if (createError || !created.user) throw new Error(`could not create test user: ${createError?.message}`);
const userId = created.user.id;
let customerId: string | null = null;

const profile = async () => {
  const { data, error } = await admin.from("profiles").select("plan, credits, stripe_subscription_id, billing_interval").eq("id", userId).single();
  if (error) throw error;
  return data;
};

/** Every relevant event for this customer, oldest first. */
async function eventsFor(since: number, objectIds: Set<string>) {
  const found: Stripe.Event[] = [];
  for await (const event of stripe.events.list({ types: TYPES, created: { gte: since }, limit: 100 })) {
    const object = event.data.object as { id?: string; customer?: string | null };
    if (object.customer === customerId || (object.id && objectIds.has(object.id))) found.push(event);
  }
  return found.sort((a, b) => a.created - b.created);
}

async function deliver(event: Stripe.Event) {
  const payload = JSON.stringify(event);
  const response = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret }) },
    body: payload,
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
}

/** Waits until Stripe has emitted at least the expected event types for this customer. */
async function waitForEvents(since: number, ids: Set<string>, expected: string[]) {
  for (let i = 0; i < 30; i++) {
    const events = await eventsFor(since, ids);
    if (expected.every((type) => events.some((e) => e.type === type))) return events;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`timed out waiting for ${expected.join(", ")}`);
}

try {
  console.log(`test user ${userId}`);
  const start = Math.floor(Date.now() / 1000) - 5;

  // ── Subscribe with the test card ─────────────────────────────────────────
  const customer = await stripe.customers.create({ email: `${userId}@example.test`, metadata: { userId, test: "flyer-studio-webhooks" } });
  customerId = customer.id;
  await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId);
  const method = await stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: method.id } });
  const subscription = await stripe.subscriptions.create({ customer: customerId, items: [{ price }], metadata: { userId, plan: "pro" } });
  assert.equal(subscription.status, "active");
  ok("subscription created and paid with the test card (4242)");

  const paidEvents = await waitForEvents(start, new Set([subscription.id]), ["invoice.paid"]);
  const invoicePaid = paidEvents.find((e) => e.type === "invoice.paid")!;
  console.log(`  events: ${paidEvents.map((e) => e.type).join(", ")}`);

  // ── Deliver every event twice ───────────────────────────────────────────
  for (const event of paidEvents) {
    const first = await deliver(event);
    assert.equal(first.status, 200, `${event.type} first delivery: ${first.status} ${JSON.stringify(first.body)}`);
    const second = await deliver(event);
    assert.equal(second.status, 200, `${event.type} replay: ${second.status}`);
    assert.equal(second.body?.duplicate, true, `${event.type} replay should be ignored as a duplicate`);
  }
  ok(`${paidEvents.length} events delivered, each replay ignored as a duplicate`);

  const afterPay = await profile();
  assert.equal(afterPay.plan, "pro");
  assert.equal(afterPay.billing_interval, "month");
  assert.equal(afterPay.stripe_subscription_id, subscription.id);
  ok("profile provisioned: plan pro, monthly, subscription linked");

  const expected = creditsForInvoice("pro", "month");
  assert.equal(afterPay.credits, expected, `credits should be exactly ${expected}`);
  const invoiceId = (invoicePaid.data.object as Stripe.Invoice).id!;
  const { data: grants } = await admin.from("credit_ledger").select("delta, idempotency_key").eq("user_id", userId).like("idempotency_key", "invoice:%");
  assert.equal(grants?.length, 1, "exactly one ledger grant");
  assert.equal(grants?.[0]?.idempotency_key, `invoice:${invoiceId}`);
  ok(`credits granted exactly once: ${afterPay.credits} (one ledger row keyed invoice:${invoiceId.slice(0, 12)}…)`);

  // A fresh event id for the same invoice (Stripe can resend) must not grant again either.
  const resent = { ...invoicePaid, id: `evt_test_resend_${randomUUID().slice(0, 8)}` };
  const resend = await deliver(resent as Stripe.Event);
  assert.equal(resend.status, 200);
  assert.equal((await profile()).credits, expected);
  ok("same invoice under a new event id: no second grant (ledger key, not just event id)");

  // ── Cancel → Free ───────────────────────────────────────────────────────
  const cancelStart = Math.floor(Date.now() / 1000) - 5;
  await stripe.subscriptions.cancel(subscription.id);
  const cancelEvents = await waitForEvents(cancelStart, new Set([subscription.id]), ["customer.subscription.deleted"]);
  for (const event of cancelEvents) {
    assert.equal((await deliver(event)).status, 200);
    assert.equal((await deliver(event)).body?.duplicate, true);
  }
  const afterCancel = await profile();
  assert.equal(afterCancel.plan, "free");
  assert.equal(afterCancel.stripe_subscription_id, null);
  assert.equal(afterCancel.credits, expected, "remaining credits are kept on cancellation");
  ok("cancellation: plan back to free, credits kept, replays ignored");

  // ── Signature check ────────────────────────────────────────────────────
  const forged = await fetch(target, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=forged" }, body: JSON.stringify(invoicePaid) });
  assert.equal(forged.status, 400);
  ok("forged signature rejected (400)");

  console.log(`\n${passed} passed`);
} finally {
  if (customerId) await stripe.customers.del(customerId).catch(() => undefined);
  await admin.auth.admin.deleteUser(userId);
  console.log("cleaned up the test customer and user");
}
