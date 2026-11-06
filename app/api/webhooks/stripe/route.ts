import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { apiError, handle } from "@/lib/api/server";
import { getStripe } from "@/lib/stripe/server";
import { onCheckoutCompleted, onInvoicePaid, onSubscriptionDeleted, onSubscriptionUpdated } from "@/lib/stripe/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Safe to replay: credit grants are idempotent in the ledger, and
 * processed event IDs are recorded only after success so failed deliveries are retried.
 */
export const POST = handle(async (request: Request) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return apiError("PAYMENTS_NOT_CONFIGURED", "STRIPE_WEBHOOK_SECRET is not set.");

  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("missing signature");
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return apiError("WEBHOOK_SIGNATURE_INVALID", "The webhook signature could not be verified.");
  }

  const admin = createAdminClient();
  const { data: seen } = await admin.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return NextResponse.json({ received: true, duplicate: true });

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
      return NextResponse.json({ received: true, ignored: event.type });
  }

  await admin.from("stripe_events").upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true });
  return NextResponse.json({ received: true });
});
