/**
 * Single source of truth for tiers, prices, credit allowances and costs. Payments go through
 * Paynow (lib/billing/paynow.ts): Pro and Max are prepaid passes of a month or a year, and
 * the price charged is read from here — never from the client.
 */

export type PlanId = "free" | "pro" | "max";
export type BillingInterval = "month" | "year";
/** psd and svg are editable designer files (Photoshop, Illustrator) — paid plans only: a watermark in an editable file is a layer anyone can delete. */
export type ExportFormatId = "png" | "pdf" | "png-2k" | "png-4k" | "psd" | "svg";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Credits per month of pass. */
  monthlyCredits: number;
  /** USD for a pass of one month or one year. A year = 10× a month (two months free). */
  price: Record<BillingInterval, number>;
  exportFormats: ExportFormatId[];
  watermark: boolean;
  priorityGeneration: boolean;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Explore the editor.",
    monthlyCredits: 0,
    price: { month: 0, year: 0 },
    exportFormats: ["png", "pdf"],
    watermark: true,
    priorityGeneration: false,
    features: ["0 credits included", "Watermarked PNG & PDF export", "30-day project retention", "No credit card required"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "For people who ship flyers every week.",
    monthlyCredits: 2_000,
    price: { month: 19.99, year: 199.9 },
    exportFormats: ["png", "pdf", "png-2k", "png-4k", "svg", "psd"],
    watermark: false,
    priorityGeneration: false,
    features: ["2,000 credits a month", "HD 2K & 4K export", "Photoshop & Illustrator files", "No watermarks", "Commercial use"],
  },
  max: {
    id: "max",
    name: "Max",
    tagline: "For teams and agencies at volume.",
    monthlyCredits: 20_000,
    price: { month: 79.99, year: 799.9 },
    exportFormats: ["png", "pdf", "png-2k", "png-4k", "svg", "psd"],
    watermark: false,
    priorityGeneration: true,
    features: ["20,000 credits a month", "Priority generation", "HD 2K & 4K export", "Photoshop & Illustrator files", "No watermarks", "Commercial use"],
  },
};

export const PAID_PLANS = ["pro", "max"] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLANS)[number];

export const CREDIT_COSTS = {
  /** One generation run produces three variations. */
  generate: 5,
  export: { png: 1, pdf: 2, "png-2k": 2, "png-4k": 4, svg: 2, psd: 3 } satisfies Record<ExportFormatId, number>,
} as const;

/** Credits a pass grants when paid. A yearly pass grants the full year up front. */
export function creditsForPass(plan: PlanId, interval: BillingInterval) {
  return PLANS[plan].monthlyCredits * (interval === "year" ? 12 : 1);
}

export function monthlyEquivalent(plan: PlanId, interval: BillingInterval) {
  const price = PLANS[plan].price[interval];
  return interval === "year" ? Math.floor((price / 12) * 100) / 100 : price;
}

export function isFormatAllowed(plan: PlanId, format: ExportFormatId) {
  return PLANS[plan].exportFormats.includes(format);
}

/** A pass that has ended is Free, even before the hourly sweep updates the stored plan. */
export function effectivePlan(plan: PlanId, periodEnd: Date | string | null | undefined, now = Date.now()): PlanId {
  if (plan === "free") return "free";
  return periodEnd && new Date(periodEnd).getTime() > now ? plan : "free";
}
