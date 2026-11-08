import type { Metadata } from "next";

import { PricingTable } from "@/components/billing/pricing-table";
import { CREDIT_COSTS } from "@flyer/core/stripe/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free to start. Pro and Max include monthly credits, HD export and no watermarks.",
};

const CREDIT_NOTES = [
  { label: "Generate", value: `${CREDIT_COSTS.generate} credits`, detail: "Three variations per prompt" },
  { label: "Export PNG", value: `${CREDIT_COSTS.export.png} credit`, detail: "Social-ready resolution" },
  { label: "Export 4K", value: `${CREDIT_COSTS.export["png-4k"]} credits`, detail: "Print-ready detail" },
];

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const { checkout } = await searchParams;
  return (
    <div className="mx-auto flex max-w-(--content-max) flex-col gap-12 px-6 py-12">
      <header className="mx-auto flex max-w-(--prose-max) flex-col gap-3 text-center">
        <h1 className="text-large-title text-fg">Pick a plan. Start printing.</h1>
        <p className="text-body text-fg-secondary">Every plan includes the full editor. Paid plans add monthly credits, HD export and no watermarks.</p>
      </header>

      <PricingTable resume={typeof checkout === "string" ? checkout : undefined} />

      <section aria-label="How credits work" className="grid gap-6 border-t border-separator pt-12 sm:grid-cols-3">
        {CREDIT_NOTES.map((note) => (
          <div key={note.label} className="flex flex-col gap-1">
            <span className="text-caption text-fg-secondary">{note.label}</span>
            <span className="text-headline text-fg">{note.value}</span>
            <span className="text-callout text-fg-secondary">{note.detail}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
