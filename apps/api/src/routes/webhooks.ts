import { prisma } from "@flyer/db";
import { Hono } from "hono";
import type Stripe from "stripe";

import { apiError, type AppEnv } from "../http";
import { getStripe } from "../stripe";
import { onCheckoutCompleted, onInvoicePaid, onSubscriptionDeleted, onSubscriptionUpdated } from "../stripe-webhook";

/**
 * Stripe webhook. Safe to replay: credit grants are idempotent in the ledger, and
 * processed event IDs are recorded only after success so failed deliveries are retried.
 */
export const webhooks = new Hono<AppEnv>().post("/stripe", async (c) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return apiError(c, "PAYMENTS_NOT_CONFIGURED", "STRIPE_WEBHOOK_SECRET is not set.");

  const signature = c.req.header("stripe-signature");
  const payload = await c.req.text();

  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("missing signature");
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return apiError(c, "WEBHOOK_SIGNATURE_INVALID", "The webhook signature could not be verified.");
  }

  const seen = await prisma.stripeEvent.findUnique({ where: { id: event.id }, select: { id: true } });
  if (seen) return c.json({ received: true, duplicate: true });

  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutCompleted(event.data.object);
      break;
    case "invoice.paid":
      await onInvoicePaid(event.data.object);
      break;
    case "customer.subscription.updated":
      await onSubscriptionUpdated(event.data.object);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object);
      break;
    default:
      return c.json({ received: true, ignored: event.type });
  }

  await prisma.stripeEvent.upsert({ where: { id: event.id }, update: {}, create: { id: event.id, type: event.type } });
  return c.json({ received: true });
});
