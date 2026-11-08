"use client";

import { useEffect, useState } from "react";

import { CheckoutSheet } from "@/components/billing/checkout-sheet";
import { useViewer } from "@/components/providers/viewer-provider";
import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { RollingNumber } from "@/components/ui/rolling-number";
import { ApiError, apiFetch } from "@/lib/api/client";
import { openBillingPortal } from "@/lib/billing/portal";
import { PLANS, type PaidPlanId, type PlanId } from "@flyer/core/stripe/plans";

export function CreditBalance() {
  const { viewer } = useViewer();
  return <RollingNumber value={viewer.credits} className="text-large-title text-fg" />;
}

export function PlanActions() {
  const { viewer } = useViewer();
  const [upgrade, setUpgrade] = useState<PaidPlanId | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (viewer.plan !== "free") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setError(null);
            openBillingPortal().catch((portalError: ApiError) => {
              setPending(false);
              setError(portalError.message);
            });
          }}
        >
          {pending ? "Opening…" : "Manage subscription"}
        </Button>
        <InlineMessage>{error}</InlineMessage>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {(["pro", "max"] as const).map((plan) => (
        <Button
          key={plan}
          variant={plan === "pro" ? "primary" : "secondary"}
          onClick={() => {
            setUpgrade(plan);
            setOpen(true);
          }}
        >
          Upgrade to {PLANS[plan].name}
        </Button>
      ))}
      {upgrade && (
        <CheckoutSheet open={open} onOpenChange={setOpen} plan={upgrade} interval="year" returnPath="/billing" />
      )}
    </div>
  );
}

/** Shown after a redirect-based payment returns to /billing?session_id=… */
export function PaymentConfirmation() {
  const { viewer, setCredits, setPlan } = useViewer();
  const [done, setDone] = useState(viewer.plan !== "free");

  useEffect(() => {
    if (done) return;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      const me = await apiFetch<{ plan: PlanId; credits: number }>("/api/me").catch(() => null);
      if ((me && me.plan !== "free") || attempts >= 10) {
        window.clearInterval(timer);
        if (me) {
          setPlan(me.plan);
          setCredits(me.credits);
        }
        setDone(true);
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [done, setCredits, setPlan]);

  return (
    <InlineMessage tone={done ? "success" : "neutral"}>
      {done ? "Payment received — your plan is active." : "Payment received. Adding your credits…"}
    </InlineMessage>
  );
}
