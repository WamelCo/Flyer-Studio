"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useOptionalViewer } from "@/components/providers/viewer-provider";
import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { ApiError, apiFetch } from "@/lib/api/client";
import { formatPrice } from "@flyer/billing/format";
import { creditsForPass, PLANS, type BillingInterval, type PaidPlanId } from "@flyer/billing/plans";
import { cn, formatCredits } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

interface PaynowCheckoutProps {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** Where to send the user to sign in and come back. */
  returnPath: string;
  /** The viewer's current pass, when known, to say what this payment does to it. */
  currentEnd?: string | null;
}

/**
 * The pass summary and the hand-off to Paynow's secure page. Paynow has no automatic
 * charges, so the copy says plainly: you pay once, and renew when it ends.
 */
export function PaynowCheckout({ plan, interval: initial, returnPath, currentEnd }: PaynowCheckoutProps) {
  const router = useRouter();
  const viewer = useOptionalViewer();
  const [interval, setPassInterval] = useState<BillingInterval>(initial);
  const [state, setState] = useState<{ status: "idle" } | { status: "redirecting" } | { status: "error"; message: string }>({ status: "idle" });
  const details = PLANS[plan];
  const price = details.price[interval];
  const credits = creditsForPass(plan, interval);
  const current = viewer?.viewer.plan ?? "free";

  // What paying does to an existing pass (mirrors fulfil_payment in the database).
  const active = current !== "free" && currentEnd ? new Date(currentEnd) : null;
  const effect =
    current === plan && active
      ? `Adds ${interval === "year" ? "12 months" : "a month"} to your pass — it will run until ${dateFormatter.format(addInterval(active, interval))}.`
      : current !== "free"
        ? `Starts today and replaces your ${PLANS[current].name} pass. Credits you already have stay.`
        : `Active until ${dateFormatter.format(addInterval(new Date(), interval))}.`;

  async function pay() {
    setState({ status: "redirecting" });
    try {
      const { redirectUrl } = await apiFetch<{ paymentId: string; redirectUrl: string }>("/api/checkout", { method: "POST", json: { plan, interval } });
      window.location.assign(redirectUrl);
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError("INTERNAL_ERROR", "Couldn't start the payment. Try again.", 500);
      if (error.code === "UNAUTHORIZED") {
        router.push(`/login?next=${encodeURIComponent(returnPath)}`);
        return;
      }
      setState({ status: "error", message: error.message });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Pass length" className="grid grid-cols-2 gap-1 rounded-control bg-fill p-1">
        {(["month", "year"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={interval === option}
            onClick={() => setPassInterval(option)}
            className={cn("focus-ring rounded-[calc(var(--radius-control)-4px)] px-3 py-2 text-callout font-medium", interval === option ? "bg-surface text-fg shadow-card" : "text-fg-secondary")}
          >
            {option === "month" ? "1 month" : "12 months · 2 free"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-control bg-surface p-5 shadow-card">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-headline text-fg">{details.name} pass</span>
          <span className="text-title text-fg">{formatPrice(price)}</span>
        </div>
        <ul className="flex flex-col gap-1.5 text-callout text-fg-secondary">
          <li>{formatCredits(credits)} credits, added as soon as you pay</li>
          <li>{effect}</li>
          <li>One payment — nothing is charged automatically. Renew whenever you like.</li>
        </ul>
      </div>

      <Button size="lg" onClick={() => void pay()} disabled={state.status === "redirecting"}>
        <Lock />
        {state.status === "redirecting" ? "Opening Paynow…" : `Pay ${formatPrice(price)} with Paynow`}
      </Button>
      <p className="text-center text-caption text-fg-secondary">EcoCash · OneMoney · InnBucks · ZimSwitch · Visa · Mastercard — on Paynow&apos;s secure page.</p>
      {state.status === "error" && <InlineMessage>{state.message}</InlineMessage>}
    </div>
  );
}

function addInterval(from: Date, interval: BillingInterval) {
  const date = new Date(from);
  if (interval === "year") date.setFullYear(date.getFullYear() + 1);
  else date.setMonth(date.getMonth() + 1);
  return date;
}
