import { NextResponse } from "next/server";

import { ApiException, handle, requireUser } from "@/lib/api/server";
import { refreshPayment } from "@flyer/billing/payments";
import { getProfile } from "@flyer/billing/payments";

export const dynamic = "force-dynamic";

/**
 * A payment's status for its owner, asking Paynow when it is still pending — the return
 * page polls this until the pass is active (or the payment failed).
 */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/checkout/[paymentId]">) => {
  const user = await requireUser();
  const { paymentId } = await params;
  const payment = await refreshPayment(paymentId, user.id);
  if (!payment) throw new ApiException("NOT_FOUND", "We couldn't find that payment.");
  const profile = await getProfile(user.id);
  return NextResponse.json({ status: payment.status, plan: profile.plan, credits: profile.credits, periodEnd: profile.currentPeriodEnd?.toISOString() ?? null });
});
