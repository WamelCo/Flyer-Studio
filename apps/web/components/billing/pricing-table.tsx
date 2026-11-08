"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useState } from "react";

import { CheckoutSheet } from "@/components/billing/checkout-sheet";
import { Button, ButtonLink } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatPrice } from "@/lib/billing/format";
import { transitions } from "@/lib/motion";
import {
  monthlyEquivalent,
  PAID_PLANS,
  PLANS,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@flyer/core/stripe/plans";
import { cn } from "@/lib/utils";

const ORDER: PlanId[] = ["free", "pro", "max"];
const FEATURED: PlanId = "pro";

export function parseCheckoutParam(value: string | undefined): { plan: PaidPlanId; interval: BillingInterval } | null {
  const [plan, interval] = (value ?? "").split("-");
  if (!PAID_PLANS.includes(plan as PaidPlanId) || (interval !== "month" && interval !== "year")) return null;
  return { plan: plan as PaidPlanId, interval };
}

function Price({ plan, interval }: { plan: PlanId; interval: BillingInterval }) {
  const amount = monthlyEquivalent(plan, interval);
  const caption =
    plan === "free"
      ? "Free forever"
      : interval === "year"
        ? `Billed ${formatPrice(PLANS[plan].price.year)} yearly`
        : "Billed monthly";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1">
        <span className="relative inline-flex overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={amount}
              initial={{ y: "60%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "-60%", opacity: 0 }}
              transition={transitions.credits}
              className="text-large-title tabular-nums text-fg"
            >
              {formatPrice(amount)}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="text-callout text-fg-secondary">/mo</span>
      </div>
      <span className="text-caption text-fg-secondary">{caption}</span>
    </div>
  );
}

/** `resume` reopens checkout after the sign-in round trip (?checkout=pro-year). */
export function PricingTable({ resume }: { resume?: string }) {
  const resumed = parseCheckoutParam(resume);
  const [interval, setBillingInterval] = useState<BillingInterval>(resumed?.interval ?? "year");
  const [checkout, setCheckout] = useState<{ plan: PaidPlanId; interval: BillingInterval } | null>(resumed);
  const [sheetOpen, setSheetOpen] = useState(Boolean(resumed));

  function startCheckout(plan: PaidPlanId) {
    setCheckout({ plan, interval });
    setSheetOpen(true);
  }

  return (
    <div className="flex flex-col items-center gap-12">
      <SegmentedControl
        label="Billing period"
        value={interval}
        onChange={setBillingInterval}
        options={[
          { value: "month", label: "Monthly" },
          {
            value: "year",
            label: (
              <>
                Annual <span className="text-caption font-semibold text-accent-text">Save 17%</span>
              </>
            ),
          },
        ]}
      />

      <div className="grid w-full items-center gap-8 md:grid-cols-3">
        {ORDER.map((id) => {
          const plan = PLANS[id];
          const featured = id === FEATURED;
          return (
            <section
              key={id}
              aria-labelledby={`plan-${id}`}
              className={cn(
                "flex flex-col gap-6 rounded-panel bg-surface p-6 md:p-8",
                featured ? "shadow-hover ring-2 ring-accent md:scale-105" : "shadow-card",
              )}
            >
              <div className="flex flex-col gap-2">
                {featured && (
                  <span className="self-start rounded-full bg-accent px-3 py-1 text-caption font-semibold text-accent-contrast">
                    Most Popular
                  </span>
                )}
                <h2 id={`plan-${id}`} className="text-title text-fg">
                  {plan.name}
                </h2>
                <p className="text-callout text-fg-secondary">{plan.tagline}</p>
              </div>

              <Price plan={id} interval={interval} />

              {id === "free" ? (
                <ButtonLink href="/dashboard" variant="secondary" size="lg">
                  Get started
                </ButtonLink>
              ) : (
                <Button
                  variant={featured ? "primary" : "secondary"}
                  size="lg"
                  onClick={() => startCheckout(id as PaidPlanId)}
                >
                  Upgrade to {plan.name}
                </Button>
              )}

              <ul className="flex flex-col gap-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-callout text-fg">
                    <Check className="mt-1 size-4 shrink-0 text-accent-text" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {checkout && (
        <CheckoutSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          plan={checkout.plan}
          interval={checkout.interval}
          returnPath={`/pricing?checkout=${checkout.plan}-${checkout.interval}`}
        />
      )}
    </div>
  );
}
