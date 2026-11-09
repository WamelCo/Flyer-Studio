import type { Metadata } from "next";

import { CreditBalance, PaymentConfirmation, PlanActions } from "@/components/billing/billing-actions";
import { PageHeader } from "@/components/shell/page-header";
import { InlineMessage } from "@/components/ui/inline-message";
import { requireViewer } from "@/lib/auth/viewer";
import { formatPrice } from "@flyer/billing/format";
import { PLANS } from "@flyer/billing/plans";
import { getProfile } from "@flyer/billing/payments";
import { and, creditLedger, db, desc, eq, payments as paymentsTable } from "@flyer/db";
import { formatCredits, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

const REASON_LABELS: Record<string, string> = {
  generate: "Generation",
  export: "Export",
  pass: "Pass credits",
  subscription: "Monthly credits",
  upgrade: "Plan upgrade",
  refund: "Refund",
};

function describeReason(reason: string) {
  return REASON_LABELS[reason.split(":")[0] ?? ""] ?? "Adjustment";
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
/** Whole days from now until `end` (negative once it has passed). This page renders per request. */
function daysUntil(end: Date | null) {
  return end ? Math.ceil((end.getTime() - Date.now()) / 86_400_000) : null;
}

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const viewer = await requireViewer("/billing");
  const [{ payment: paymentId }, profile, ledger, payments] = await Promise.all([
    searchParams,
    getProfile(viewer.id),
    db()
      .select({ id: creditLedger.id, delta: creditLedger.delta, reason: creditLedger.reason, createdAt: creditLedger.createdAt })
      .from(creditLedger)
      .where(eq(creditLedger.userId, viewer.id))
      .orderBy(desc(creditLedger.createdAt))
      .limit(12),
    db()
      .select({ id: paymentsTable.id, plan: paymentsTable.plan, interval: paymentsTable.billingInterval, amount: paymentsTable.amount, paidAt: paymentsTable.paidAt, paynowReference: paymentsTable.paynowReference })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.userId, viewer.id), eq(paymentsTable.status, "paid")))
      .orderBy(desc(paymentsTable.paidAt))
      .limit(12),
  ]);

  const plan = PLANS[profile.plan];
  const end = profile.currentPeriodEnd;
  const daysLeft = daysUntil(end);
  // The stored plan may still say Pro for up to an hour after a pass ends; getProfile already reads it as Free.
  const lapsed = profile.plan === "free" && end !== null && daysLeft !== null && daysLeft <= 0;

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-6 py-8 md:px-10 md:py-12">
      <PageHeader title="Billing" description="Your pass, credits and history." />
      {typeof paymentId === "string" && /^[0-9a-f-]{36}$/i.test(paymentId) && <PaymentConfirmation paymentId={paymentId} />}
      {profile.plan !== "free" && daysLeft !== null && daysLeft <= 5 && (
        <InlineMessage>{`Your ${plan.name} pass ends ${daysLeft <= 1 ? "within a day" : `in ${daysLeft} days`}. Renew to keep your monthly credits and HD exports.`}</InlineMessage>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="plan-heading" className="flex flex-col gap-6 rounded-panel bg-surface p-6 shadow-card">
          <div className="flex flex-col gap-1">
            <span className="text-caption text-fg-secondary">Current plan</span>
            <h2 id="plan-heading" className="text-title text-fg">
              {plan.name}
            </h2>
            <p className="text-callout text-fg-secondary">
              {profile.plan !== "free" && end
                ? `${formatPrice(plan.price[profile.billingInterval ?? "month"])} pass · active until ${dateFormatter.format(end)}`
                : lapsed && end
                  ? `Your pass ended ${dateFormatter.format(end)}. Your credits are still here — get a new pass for HD exports and no watermarks.`
                  : "Watermarked exports. Get a Pro or Max pass for monthly credits and HD export."}
            </p>
          </div>
          <PlanActions currentEnd={profile.plan !== "free" ? (profile.currentPeriodEnd?.toISOString() ?? null) : null} />
          <p className="text-caption text-fg-secondary">Passes are paid once through Paynow (EcoCash, OneMoney, cards). Nothing renews automatically.</p>
        </section>

        <section aria-labelledby="credits-heading" className="flex flex-col gap-6 rounded-panel bg-surface p-6 shadow-card">
          <div className="flex flex-col gap-1">
            <span id="credits-heading" className="text-caption text-fg-secondary">
              Credits
            </span>
            <CreditBalance />
            <p className="text-callout text-fg-secondary">
              {plan.monthlyCredits > 0 ? `${formatCredits(plan.monthlyCredits)} credits for each month of your pass.` : "Free includes no monthly credits."}
              {profile.freeFlyers > 0 ? ` Plus ${profile.freeFlyers} free flyer${profile.freeFlyers === 1 ? "" : "s"} (watermarked), on the web or on WhatsApp.` : ""}
            </p>
          </div>
        </section>
      </div>

      {payments.length > 0 && (
        <section aria-labelledby="payments-heading" className="flex flex-col gap-4">
          <h2 id="payments-heading" className="text-headline text-fg">
            Payments
          </h2>
          <ul className="divide-y divide-separator overflow-hidden rounded-panel bg-surface shadow-card">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-callout text-fg">
                    {PLANS[payment.plan].name} pass · {payment.interval === "year" ? "12 months" : "1 month"}
                  </span>
                  <span className="text-caption text-fg-secondary">
                    {payment.paidAt ? dateFormatter.format(payment.paidAt) : ""}
                    {payment.paynowReference ? ` · Paynow ${payment.paynowReference}` : ""}
                  </span>
                </div>
                <span className="text-callout font-semibold text-fg">{formatPrice(Number(payment.amount))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="history-heading" className="flex flex-col gap-4">
        <h2 id="history-heading" className="text-headline text-fg">
          Credit history
        </h2>
        {ledger.length > 0 ? (
          <ul className="divide-y divide-separator overflow-hidden rounded-panel bg-surface shadow-card">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-callout text-fg">{describeReason(entry.reason)}</span>
                  <span className="text-caption text-fg-secondary">{formatRelativeTime(entry.createdAt.toISOString())}</span>
                </div>
                <span className={entry.delta > 0 ? "text-callout font-semibold text-success" : "text-callout font-semibold text-fg"}>
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
