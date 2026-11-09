import { randomUUID } from "node:crypto";
import { and, db, eq, fulfilPayment, getProfileRow, ne, payments } from "@flyer/db";
import { log } from "@flyer/log";

import { initiateTransaction, paynowConfig, pollTransaction, type StatusResult } from "./paynow";
import { creditsForPass, effectivePlan, PLANS, type BillingInterval, type PaidPlanId } from "./plans";

/**
 * Passes bought through Paynow. Server only; shared by the web app and the WhatsApp bot.
 *
 *  start   → a `payments` row (our id is the Paynow reference) and Paynow's payment page.
 *  settle  → a verified status: paid → fulfil_payment (credits once + pass), else recorded.
 *  refresh → polls Paynow for a payment still pending; the return page, the result URL and
 *            the WhatsApp bot all use it, so a missed notification still completes the purchase.
 */

export type PaymentStatus = "created" | "sent" | "paid" | "cancelled" | "failed";

export class BillingError extends Error {
  constructor(
    readonly code: "PAYMENTS_NOT_CONFIGURED" | "PAYMENT_FAILED",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** A profile with its plan as it stands now (an ended pass reads as Free immediately). */
export async function getProfile(userId: string) {
  const row = await getProfileRow(userId);
  if (!row) throw new Error("profile lookup failed: no profile");
  return { ...row, plan: effectivePlan(row.plan, row.currentPeriodEnd) };
}

export async function startPayment(
  user: { id: string; email: string | null },
  plan: PaidPlanId,
  interval: BillingInterval,
  { returnPath }: { returnPath?: (paymentId: string) => string } = {},
) {
  const config = paynowConfig();
  if (!config) {
    throw new BillingError(
      "PAYMENTS_NOT_CONFIGURED",
      process.env.NODE_ENV === "development" ? "Payments need PAYNOW_INTEGRATION_ID and PAYNOW_INTEGRATION_KEY in .env.local." : "Payments aren't configured on this site yet.",
    );
  }
  const id = randomUUID();
  const amount = PLANS[plan].price[interval];
  await db().insert(payments).values({ id, userId: user.id, plan, billingInterval: interval, amount, credits: creditsForPass(plan, interval) });

  const result = await initiateTransaction(config, {
    reference: id,
    amount,
    info: `Flyer Studio ${PLANS[plan].name} — ${interval === "year" ? "12 months" : "1 month"}`,
    returnUrl: `${siteUrl()}${returnPath ? returnPath(id) : `/billing?payment=${id}`}`,
    resultUrl: `${siteUrl()}/api/webhooks/paynow`,
    authEmail: user.email,
  });
  if (!result.ok) {
    await db().update(payments).set({ status: "failed" }).where(eq(payments.id, id));
    log.warn("paynow.initiate_failed", { payment: id, error: result.error });
    throw new BillingError("PAYMENT_FAILED", "Paynow couldn't start the payment. Please try again in a moment.", { reason: result.error });
  }
  await db().update(payments).set({ status: "sent", pollUrl: result.pollUrl }).where(eq(payments.id, id));
  log.info("paynow.started", { payment: id, plan, interval, amount });
  return { paymentId: id, redirectUrl: result.browserUrl };
}

interface PaymentRow {
  id: string;
  userId: string;
  amount: number;
  status: string;
}

/** Applies a verified Paynow status to a payment. Idempotent: replays change nothing. */
export async function settlePayment(payment: PaymentRow, status: Extract<StatusResult, { ok: true }>): Promise<PaymentStatus> {
  if (status.outcome === "paid") {
    // Paynow reports what was actually paid; a short payment never buys a pass.
    if (status.amount !== null && status.amount + 0.005 < Number(payment.amount)) {
      log.error("paynow.amount_mismatch", { payment: payment.id, expected: payment.amount, paid: status.amount });
      return "failed";
    }
    const row = await fulfilPayment(payment.id, status.paynowReference);
    if (row.newlyPaid) log.info("paynow.paid", { payment: payment.id, plan: row.plan, until: row.periodEnd });
    return "paid";
  }
  if (status.outcome === "failed" && payment.status !== "paid") {
    const next = /cancel/i.test(status.status) ? "cancelled" : "failed";
    await db().update(payments).set({ status: next }).where(and(eq(payments.id, payment.id), ne(payments.status, "paid")));
    return next;
  }
  return payment.status as PaymentStatus;
}

/** A payment's current state, asking Paynow first when it is still pending. */
export async function refreshPayment(paymentId: string, userId?: string): Promise<{ status: PaymentStatus; plan: PaidPlanId; interval: BillingInterval; credits: number } | null> {
  const [payment] = await db()
    .select({ id: payments.id, userId: payments.userId, plan: payments.plan, interval: payments.billingInterval, amount: payments.amount, credits: payments.credits, status: payments.status, pollUrl: payments.pollUrl })
    .from(payments)
    .where(userId ? and(eq(payments.id, paymentId), eq(payments.userId, userId)) : eq(payments.id, paymentId))
    .limit(1);
  if (!payment) return null;
  let status = payment.status as PaymentStatus;
  const config = paynowConfig();
  if ((status === "sent" || status === "created") && payment.pollUrl && config) {
    const polled = await pollTransaction(config, payment.pollUrl);
    if (polled.ok && (polled.reference === null || polled.reference === payment.id)) status = await settlePayment(payment, polled);
    else if (!polled.ok) log.warn("paynow.poll_failed", { payment: payment.id, error: polled.error });
  }
  return { status, plan: payment.plan as PaidPlanId, interval: payment.interval, credits: payment.credits };
}
