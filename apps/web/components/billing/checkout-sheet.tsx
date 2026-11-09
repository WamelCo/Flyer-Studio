"use client";

import { PaynowCheckout } from "@/components/billing/paynow-checkout";
import { Sheet } from "@/components/ui/sheet";
import { PLANS, type BillingInterval, type PaidPlanId } from "@flyer/billing/plans";

interface CheckoutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PaidPlanId;
  interval: BillingInterval;
  returnPath: string;
  /** End of the viewer's current pass, if they have one. */
  currentEnd?: string | null;
}

export function CheckoutSheet({ open, onOpenChange, plan, interval, returnPath, currentEnd }: CheckoutSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`${PLANS[plan].name} pass`} description={PLANS[plan].tagline} className="sm:max-w-md">
      <div className="px-4 pb-4 sm:px-6 sm:pb-6">
        <PaynowCheckout key={`${plan}-${interval}`} plan={plan} interval={interval} returnPath={returnPath} currentEnd={currentEnd} />
      </div>
    </Sheet>
  );
}
