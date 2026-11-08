/**
 * Single source of truth for tiers, credit allowances, costs and Stripe price IDs.
 * Price IDs come from env and are only resolved on the server; components never see them.
 */

export type PlanId = "free" | "pro" | "max";
export type BillingInterval = "month" | "year";
export type ExportFormatId = "png" | "pdf" | "png-2k" | "png-4k";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Credits granted each billing month. */
  monthlyCredits: number;
  /** USD charged per interval. Annual = 10× monthly (two months free). */
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
    exportFormats: ["png", "pdf", "png-2k", "png-4k"],
    watermark: false,
    priorityGeneration: false,
    features: ["2,000 credits every month", "HD 2K & 4K export", "No watermarks", "Commercial use"],
  },
  max: {
    id: "max",
    name: "Max",
    tagline: "For teams and agencies at volume.",
    monthlyCredits: 20_000,
    price: { month: 79.99, year: 799.9 },
    exportFormats: ["png", "pdf", "png-2k", "png-4k"],
    watermark: false,
    priorityGeneration: true,
    features: ["20,000 credits every month", "Priority generation", "HD 2K & 4K export", "No watermarks", "Commercial use"],
  },
};

export const PAID_PLANS = ["pro", "max"] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLANS)[number];

export const CREDIT_COSTS = {
  /** One generation run produces three variations. */
  generate: 5,
  export: { png: 1, pdf: 2, "png-2k": 2, "png-4k": 4 } satisfies Record<ExportFormatId, number>,
  /**
   * Rendering a design with the renderer (Ideogram). The first render of each generation
   * is included in `generate`; rendering another design from the same generation costs this.
   */
  render: 5,
} as const;

/** Credits granted for one paid invoice. Annual invoices grant the full year up front. */
export function creditsForInvoice(plan: PlanId, interval: BillingInterval) {
  return PLANS[plan].monthlyCredits * (interval === "year" ? 12 : 1);
}

export function monthlyEquivalent(plan: PlanId, interval: BillingInterval) {
  const price = PLANS[plan].price[interval];
  return interval === "year" ? Math.floor((price / 12) * 100) / 100 : price;
}

export function isFormatAllowed(plan: PlanId, format: ExportFormatId) {
  return PLANS[plan].exportFormats.includes(format);
}

// ── Server only ───────────────────────────────────────────────────────────

const PRICE_ENV: Record<PaidPlanId, Record<BillingInterval, string>> = {
  pro: { month: "STRIPE_PRICE_PRO_MONTHLY", year: "STRIPE_PRICE_PRO_ANNUAL" },
  max: { month: "STRIPE_PRICE_MAX_MONTHLY", year: "STRIPE_PRICE_MAX_ANNUAL" },
};

export function stripePriceId(plan: PaidPlanId, interval: BillingInterval): string | undefined {
  return process.env[PRICE_ENV[plan][interval]] || undefined;
}

export function planFromPriceId(priceId: string): { plan: PaidPlanId; interval: BillingInterval } | null {
  for (const plan of PAID_PLANS) {
    for (const interval of ["month", "year"] as const) {
      if (stripePriceId(plan, interval) === priceId) return { plan, interval };
    }
  }
  return null;
}
