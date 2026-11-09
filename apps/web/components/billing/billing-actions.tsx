"use client";

import { useEffect, useState } from "react";

import { CheckoutSheet } from "@/components/billing/checkout-sheet";
import { useViewer } from "@/components/providers/viewer-provider";
import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { RollingNumber } from "@/components/ui/rolling-number";
import { apiFetch } from "@/lib/api/client";
import { PLANS, type PaidPlanId, type PlanId } from "@flyer/billing/plans";

export function CreditBalance() {
  const { viewer } = useViewer();
  return <RollingNumber value={viewer.credits} className="text-large-title text-fg" />;
}

/** Upgrade (Free), or renew / switch (on a pass). Every purchase is a one-off Paynow payment. */
export function PlanActions({ currentEnd }: { currentEnd: string | null }) {
  const { viewer } = useViewer();
  const [checkout, setCheckout] = useState<PaidPlanId | null>(null);
  const [open, setOpen] = useState(false);
  const show = (plan: PaidPlanId) => {
    setCheckout(plan);
    setOpen(true);
  };
  const current = viewer.plan;
  const other: PaidPlanId = current === "max" ? "pro" : "max";

  return (
    <div className="flex flex-wrap gap-3">
      {current === "free" ? (
        (["pro", "max"] as const).map((plan) => (
          <Button key={plan} variant={plan === "pro" ? "primary" : "secondary"} onClick={() => show(plan)}>
            Get {PLANS[plan].name}
          </Button>
        ))
      ) : (
        <>
          <Button onClick={() => show(current)}>Renew {PLANS[current].name}</Button>
          <Button variant="secondary" onClick={() => show(other)}>
            Switch to {PLANS[other].name}
          </Button>
        </>
      )}
      {checkout && <CheckoutSheet open={open} onOpenChange={setOpen} plan={checkout} interval="month" returnPath="/billing" currentEnd={currentEnd} />}
    </div>
  );
}

type Settled = "paid" | "cancelled" | "failed";

/**
 * Shown on return from Paynow (/billing?payment=<id>). Each check asks our server, which
 * asks Paynow — mobile money can take a minute to confirm, so it keeps checking for a while.
 */
export function PaymentConfirmation({ paymentId }: { paymentId: string }) {
  const { setCredits, setPlan } = useViewer();
  const [state, setState] = useState<"checking" | Settled | "slow">("checking");

  useEffect(() => {
    let attempts = 0;
    let stopped = false;
    const check = async () => {
      attempts += 1;
      const result = await apiFetch<{ status: string; plan: PlanId; credits: number }>(`/api/checkout/${paymentId}`).catch(() => null);
      if (stopped) return;
      if (result?.status === "paid") {
        setPlan(result.plan);
        setCredits(result.credits);
        setState("paid");
        return;
      }
      if (result?.status === "cancelled" || result?.status === "failed") {
        setState(result.status);
        return;
      }
      if (attempts >= 40) {
        setState("slow");
        return;
      }
      timer = window.setTimeout(check, attempts < 10 ? 2000 : 4000);
    };
    let timer = window.setTimeout(check, 600);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [paymentId, setCredits, setPlan]);

  const copy: Record<typeof state, string> = {
    checking: "Confirming your payment with Paynow…",
    paid: "Payment received — your pass is active and your credits are in.",
    cancelled: "The payment was cancelled. Nothing was charged.",
    failed: "The payment didn't go through. Nothing was charged — try again or use another method.",
    slow: "Paynow hasn't confirmed yet. If you approved the payment, your pass will activate as soon as it does — check back in a few minutes.",
  };
  return <InlineMessage tone={state === "paid" ? "success" : "neutral"}>{copy[state]}</InlineMessage>;
}
