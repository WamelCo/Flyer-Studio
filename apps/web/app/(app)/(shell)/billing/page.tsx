import type { Metadata } from "next";

import { CreditBalance, PaymentConfirmation, PlanActions } from "@/components/billing/billing-actions";
import { PageHeader } from "@/components/shell/page-header";
import { requireViewer } from "@/lib/auth/viewer";
import { formatPrice } from "@/lib/billing/format";
import type { BillingSummary } from "@flyer/core/api/contracts";
import { PLANS } from "@flyer/core/stripe/plans";
import { serverApi } from "@/lib/api/server";
import { formatCredits, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

const REASON_LABELS: Record<string, string> = {
  generate: "Generation",
  export: "Export",
  render: "Render",
  subscription: "Monthly credits",
  upgrade: "Plan upgrade",
  refund: "Refund",
};

function describeReason(reason: string) {
  return REASON_LABELS[reason.split(":")[0] ?? ""] ?? "Adjustment";
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  await requireViewer("/billing");
  const [{ session_id: sessionId }, profile] = await Promise.all([searchParams, serverApi<BillingSummary>("/api/billing/summary")]);
  const ledger = profile.ledger;

  const plan = PLANS[profile.plan];
  const interval = profile.billingInterval ?? "month";

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-6 py-8 md:px-10 md:py-12">
      <PageHeader title="Billing" description="Your plan, credits and history." />
      {typeof sessionId === "string" && <PaymentConfirmation />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="plan-heading" className="flex flex-col gap-6 rounded-panel bg-surface p-6 shadow-card">
          <div className="flex flex-col gap-1">
            <span className="text-caption text-fg-secondary">Current plan</span>
            <h2 id="plan-heading" className="text-title text-fg">
              {plan.name}
            </h2>
            <p className="text-callout text-fg-secondary">
              {profile.plan === "free"
                ? "Watermarked exports. Upgrade for monthly credits and HD export."
                : `${formatPrice(plan.price[interval])} per ${interval}${
                    profile.currentPeriodEnd
                      ? ` · renews ${dateFormatter.format(new Date(profile.currentPeriodEnd))}`
                      : ""
                  }`}
            </p>
          </div>
          <PlanActions />
        </section>

        <section aria-labelledby="credits-heading" className="flex flex-col gap-6 rounded-panel bg-surface p-6 shadow-card">
          <div className="flex flex-col gap-1">
            <span id="credits-heading" className="text-caption text-fg-secondary">
              Credits
            </span>
            <CreditBalance />
            <p className="text-callout text-fg-secondary">
              {plan.monthlyCredits > 0
                ? `${formatCredits(plan.monthlyCredits)} added every billing month.`
                : "Free includes no monthly credits."}
            </p>
          </div>
        </section>
      </div>

      <section aria-labelledby="history-heading" className="flex flex-col gap-4">
        <h2 id="history-heading" className="text-headline text-fg">
          History
        </h2>
        {ledger.length > 0 ? (
          <ul className="divide-y divide-separator overflow-hidden rounded-panel bg-surface shadow-card">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-callout text-fg">{describeReason(entry.reason)}</span>
                  <span className="text-caption text-fg-secondary">{formatRelativeTime(entry.created_at)}</span>
                </div>
                <span
                  className={
                    entry.delta > 0 ? "text-callout font-semibold text-success" : "text-callout font-semibold text-fg"
                  }
                >
                  {entry.delta > 0 ? "+" : "−"}
                  {formatCredits(Math.abs(entry.delta))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-callout text-fg-secondary">Credit activity will appear here.</p>
        )}
      </section>
    </div>
  );
}
