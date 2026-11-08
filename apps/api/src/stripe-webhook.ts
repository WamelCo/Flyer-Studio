import { creditsForInvoice, planFromPriceId, type BillingInterval, type PaidPlanId } from "@flyer/core/stripe/plans";
import { addCredits, prisma } from "@flyer/db";
import type Stripe from "stripe";

import { getStripe } from "./stripe";

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
  const profile = await prisma.profile.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } });
  return profile?.id ?? null;
}

/** Back to Free — only if this subscription is still the one on the profile. */
async function downgrade(userId: string, subscriptionId: string) {
  await prisma.profile.updateMany({
    where: { id: userId, stripeSubscriptionId: subscriptionId },
    data: { plan: "free", stripeSubscriptionId: null, billingInterval: null, currentPeriodEnd: null },
  });
}

async function syncSubscription(subscription: Stripe.Subscription, userId: string) {
  const resolved = subscriptionPlan(subscription);

  if (ENDED_STATUSES.includes(subscription.status) || !resolved) {
    await downgrade(userId, subscription.id);
    return null;
  }

  await prisma.profile.update({
    where: { id: userId },
    data: {
      plan: resolved.plan,
      billingInterval: resolved.interval,
      stripeCustomerId: id(subscription.customer),
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: new Date(resolved.periodEnd * 1000),
    },
  });
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
  if (userId) await downgrade(userId, subscription.id);
}
