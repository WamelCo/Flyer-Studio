import type Stripe from "stripe";

import { addCredits } from "@/lib/db/credits";
import { creditsForInvoice, planFromPriceId, type BillingInterval, type PaidPlanId } from "@/lib/stripe/plans";
import { getStripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Idempotency: credit grants are keyed `invoice:<invoice id>` in the ledger. Stripe
 * fires both checkout.session.completed and invoice.paid for the first payment, and may
 * replay either — every path that grants for an invoice uses the same key, so the
 * credits land exactly once. Plan syncs are plain "set" updates and naturally idempotent.
 */

const ENDED_STATUSES: Stripe.Subscription.Status[] = ["canceled", "unpaid", "incomplete_expired"];

function id(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function subscriptionPlan(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  const resolved = item ? planFromPriceId(item.price.id) : null;
  return resolved ? { ...resolved, periodEnd: item!.current_period_end } : null;
}

async function resolveUserId(subscription: Stripe.Subscription) {
  if (subscription.metadata.userId) return subscription.metadata.userId;
  const customerId = id(subscription.customer);
  if (!customerId) return null;
  const { data } = await createAdminClient().from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return data?.id ?? null;
}

async function syncSubscription(subscription: Stripe.Subscription, userId: string) {
  const admin = createAdminClient();
  const resolved = subscriptionPlan(subscription);

  if (ENDED_STATUSES.includes(subscription.status) || !resolved) {
    await admin
      .from("profiles")
      .update({ plan: "free", stripe_subscription_id: null, billing_interval: null, current_period_end: null })
      .eq("id", userId)
      .eq("stripe_subscription_id", subscription.id);
    return null;
  }

  await admin
    .from("profiles")
    .update({
      plan: resolved.plan,
      billing_interval: resolved.interval,
      stripe_customer_id: id(subscription.customer),
      stripe_subscription_id: subscription.id,
      current_period_end: new Date(resolved.periodEnd * 1000).toISOString(),
    })
    .eq("id", userId);
  return resolved;
}

async function grantForInvoice(userId: string, invoiceId: string, plan: PaidPlanId, interval: BillingInterval) {
  await addCredits({
    userId,
    amount: creditsForInvoice(plan, interval),
    reason: `subscription:${plan}:${interval}`,
    idempotencyKey: `invoice:${invoiceId}`,
  });
}

export async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription" || session.payment_status !== "paid") return;
  const subscriptionId = id(session.subscription);
  if (!subscriptionId) return;

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const userId = session.client_reference_id ?? session.metadata?.userId ?? (await resolveUserId(subscription));
  if (!userId) throw new Error(`checkout ${session.id}: no user to provision`);

  const resolved = await syncSubscription(subscription, userId);
  const invoiceId = id(session.invoice);
  if (resolved && invoiceId) await grantForInvoice(userId, invoiceId, resolved.plan, resolved.interval);
}

export async function onInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = id(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId || !invoice.id) return;

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const userId = await resolveUserId(subscription);
  if (!userId) throw new Error(`invoice ${invoice.id}: no user for subscription ${subscriptionId}`);

  const resolved = await syncSubscription(subscription, userId);
  if (!resolved) return;

  if (invoice.billing_reason === "subscription_create" || invoice.billing_reason === "subscription_cycle") {
    await grantForInvoice(userId, invoice.id, resolved.plan, resolved.interval);
    return;
  }

  // Mid-cycle upgrade (e.g. Pro → Max in the portal): grant the difference in allowance.
  if (invoice.billing_reason === "subscription_update" && invoice.amount_paid > 0) {
    const previous = invoice.lines.data
      .filter((line) => line.amount < 0)
      .map((line) => id(line.pricing?.price_details?.price))
      .map((price) => (price ? planFromPriceId(price) : null))
      .find(Boolean);
    const before = previous ? creditsForInvoice(previous.plan, previous.interval) : 0;
    const difference = creditsForInvoice(resolved.plan, resolved.interval) - before;
    if (previous && difference > 0) {
      await addCredits({
        userId,
        amount: difference,
        reason: `upgrade:${previous.plan}->${resolved.plan}`,
        idempotencyKey: `invoice:${invoice.id}`,
      });
    }
  }
}

export async function onSubscriptionUpdated(subscription: Stripe.Subscription) {
  const userId = await resolveUserId(subscription);
  if (userId) await syncSubscription(subscription, userId);
}

/** Cancellation: back to Free. Remaining credits are kept; exports become watermarked. */
export async function onSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = await resolveUserId(subscription);
  if (!userId) return;
  await createAdminClient()
    .from("profiles")
    .update({ plan: "free", stripe_subscription_id: null, billing_interval: null, current_period_end: null })
    .eq("id", userId)
    .eq("stripe_subscription_id", subscription.id);
}
