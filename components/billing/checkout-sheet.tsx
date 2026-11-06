"use client";

import dynamic from "next/dynamic";

import { CheckoutSkeleton } from "@/components/billing/checkout-skeleton";
import { Sheet } from "@/components/ui/sheet";
import { formatPrice } from "@/lib/billing/format";
import { PLANS, type BillingInterval, type PaidPlanId } from "@/lib/stripe/plans";
import { formatCredits } from "@/lib/utils";

// Stripe.js loads only when someone actually opens checkout.
const EmbeddedCheckoutPanel = dynamic(() => import("@/components/billing/embedded-checkout-panel"), {
  ssr: false,
  loading: () => <CheckoutSkeleton />,
});

interface CheckoutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PaidPlanId;
  interval: BillingInterval;
  returnPath: string;
}

export function CheckoutSheet({ open, onOpenChange, plan, interval, returnPath }: CheckoutSheetProps) {
  const details = PLANS[plan];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Upgrade to ${details.name}`}
      description={`${formatPrice(details.price[interval])} per ${interval} · ${formatCredits(details.monthlyCredits)} credits every month`}
      className="sm:max-w-xl"
    >
      <div className="px-4 pb-4 sm:px-6 sm:pb-6">
        <EmbeddedCheckoutPanel key={`${plan}-${interval}`} plan={plan} interval={interval} returnPath={returnPath} />
      </div>
    </Sheet>
  );
}
