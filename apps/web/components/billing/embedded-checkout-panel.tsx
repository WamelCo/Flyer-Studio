"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CheckoutSkeleton } from "@/components/billing/checkout-skeleton";
import { useOptionalViewer } from "@/components/providers/viewer-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { RollingNumber } from "@/components/ui/rolling-number";
import { SuccessCheck } from "@/components/ui/success-check";
import { ApiError, apiFetch } from "@/lib/api/client";
import { openBillingPortal } from "@/lib/billing/portal";
import { fadeVariants } from "@/lib/motion";
import { PLANS, type BillingInterval, type PaidPlanId, type PlanId } from "@flyer/core/stripe/plans";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

type State =
  | { status: "loading" }
  | { status: "ready"; clientSecret: string }
  | { status: "error"; error: ApiError }
  | { status: "complete" };

interface PanelProps {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** Where to send the user to sign in and come back. */
  returnPath: string;
}

export default function EmbeddedCheckoutPanel({ plan, interval, returnPath }: PanelProps) {
  const router = useRouter();
  const viewer = useOptionalViewer();
  const [state, setState] = useState<State>(() =>
    stripePromise
      ? { status: "loading" }
      : {
          status: "error",
          error: new ApiError(
            "PAYMENTS_NOT_CONFIGURED",
            process.env.NODE_ENV === "development"
              ? "Payments need NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_…) in .env.local. Add it and restart pnpm dev."
              : "Payments aren't configured on this site yet.",
            503,
          ),
        },
  );
  const [confirmed, setConfirmed] = useState<{ plan: PlanId; credits: number } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!stripePromise) return;
    let cancelled = false;
    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    apiFetch<{ clientSecret: string }>("/api/checkout", { method: "POST", json: { plan, interval, theme } })
      .then(({ clientSecret }) => !cancelled && setState({ status: "ready", clientSecret }))
      .catch((error: ApiError) => {
        if (cancelled) return;
        if (error.code === "UNAUTHORIZED") {
          router.push(`/login?next=${encodeURIComponent(returnPath)}`);
          return;
        }
        setState({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
  }, [plan, interval, returnPath, router, attempt]);

  // After payment, the webhook provisions credits. Poll briefly so the balance rolls up in place.
  useEffect(() => {
    if (state.status !== "complete") return;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const me = await apiFetch<{ plan: PlanId; credits: number }>("/api/me");
        if (me.plan === plan || attempts >= 10) {
          window.clearInterval(timer);
          setConfirmed(me);
          viewer?.setPlan(me.plan);
          viewer?.setCredits(me.credits);
        }
      } catch {
        if (attempts >= 10) window.clearInterval(timer);
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [state.status, plan, viewer]);

  if (state.status === "error") {
    const { error } = state;
    return (
      <div className="flex flex-col items-start gap-4 rounded-control bg-surface p-6">
        <InlineMessage>{error.message}</InlineMessage>
        {error.code === "CONFLICT" ? (
          <Button
            variant="secondary"
            onClick={() => openBillingPortal().catch((portalError: ApiError) => setState({ status: "error", error: portalError }))}
          >
            Manage subscription
          </Button>
        ) : error.code !== "PAYMENTS_NOT_CONFIGURED" ? (
          <Button
            variant="secondary"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  if (state.status === "complete") {
    return (
      <motion.div
        variants={fadeVariants}
        initial="initial"
        animate="animate"
        className="flex flex-col items-center gap-4 rounded-control bg-surface p-8 text-center"
      >
        <SuccessCheck />
        <div className="flex flex-col gap-1">
          <p className="text-headline text-fg">Welcome to {PLANS[plan].name}</p>
          <p className="text-callout text-fg-secondary">
            {confirmed ? (
              <>
                You have <RollingNumber value={confirmed.credits} className="font-semibold text-fg" /> credits.
              </>
            ) : (
              "Adding your credits…"
            )}
          </p>
        </div>
        <ButtonLink href="/dashboard" size="lg" className="w-full">
          Start creating
        </ButtonLink>
      </motion.div>
    );
  }

  if (state.status === "loading" || !stripePromise) return <CheckoutSkeleton />;

  return (
    <div className="overflow-hidden rounded-control bg-surface">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ clientSecret: state.clientSecret, onComplete: () => setState({ status: "complete" }) }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
