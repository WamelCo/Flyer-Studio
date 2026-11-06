/**
 * One-time Stripe setup for test mode. Safe to re-run: everything is found before it is created.
 *   pnpm stripe:setup
 *
 * Creates the Pro and Max products with monthly and annual prices (amounts from
 * lib/stripe/plans.ts), a Customer Portal configuration that lets subscribers switch
 * between them or cancel, and writes the resulting IDs into .env.local.
 * Refuses live-mode keys.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";

import { PAID_PLANS, PLANS, type BillingInterval } from "../lib/stripe/plans.ts";

const ENV_FILE = join(import.meta.dirname, "..", ".env.local");
const APP = "flyer-studio";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) fail("STRIPE_SECRET_KEY is empty in .env.local. Add your test key (sk_test_…) from dashboard.stripe.com/test/apikeys.");
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) fail("This script only runs against Stripe test mode. Use an sk_test_ key.");

const stripe = new Stripe(key, { appInfo: { name: "Flyer Studio setup" } });
const ENV_NAMES: Record<string, string> = {
  "pro:month": "STRIPE_PRICE_PRO_MONTHLY",
  "pro:year": "STRIPE_PRICE_PRO_ANNUAL",
  "max:month": "STRIPE_PRICE_MAX_MONTHLY",
  "max:year": "STRIPE_PRICE_MAX_ANNUAL",
};
const env: Record<string, string> = {};
const portalProducts: { product: string; prices: string[] }[] = [];

for (const planId of PAID_PLANS) {
  const plan = PLANS[planId];
  const product = await findOrCreateProduct(planId, plan.name, plan.tagline);
  const prices: string[] = [];
  for (const interval of ["month", "year"] as BillingInterval[]) {
    const price = await findOrCreatePrice(product.id, planId, interval, Math.round(plan.price[interval] * 100));
    env[ENV_NAMES[`${planId}:${interval}`]!] = price.id;
    prices.push(price.id);
  }
  portalProducts.push({ product: product.id, prices });
}

env.STRIPE_PORTAL_CONFIGURATION = (await findOrCreatePortal(portalProducts)).id;
writeEnv(env);

console.log("\nStripe test mode is set up. Written to .env.local:");
for (const [name, value] of Object.entries(env)) console.log(`  ${name}=${value}`);
console.log("\nNext: `pnpm stripe:webhooks` in a second terminal while `pnpm dev` runs.");

// ── Helpers ─────────────────────────────────────────────────────────────────

async function findOrCreateProduct(planId: string, name: string, description: string) {
  // products.list, not products.search: search is eventually consistent and misses new products.
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata.app === APP && product.metadata.plan === planId) {
      console.log(`✓ product ${name} exists (${product.id})`);
      return product;
    }
  }
  const product = await stripe.products.create(
    { name: `Flyer Studio ${name}`, description, metadata: { app: APP, plan: planId } },
    { idempotencyKey: `${APP}:product:${planId}` },
  );
  console.log(`+ created product ${product.name} (${product.id})`);
  return product;
}

async function findOrCreatePrice(product: string, planId: string, interval: BillingInterval, unitAmount: number) {
  const lookupKey = `${APP}_${planId}_${interval}`;
  const existing = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0];
  if (existing && existing.unit_amount === unitAmount && existing.product === product) {
    console.log(`✓ price ${lookupKey} exists (${existing.id})`);
    return existing;
  }
  // A changed amount gets a new price; transfer_lookup_key moves the key to it.
  const price = await stripe.prices.create({
    product,
    currency: "usd",
    unit_amount: unitAmount,
    recurring: { interval },
    lookup_key: lookupKey,
    transfer_lookup_key: Boolean(existing),
    metadata: { app: APP, plan: planId, interval },
  });
  console.log(`+ created price ${lookupKey} $${(unitAmount / 100).toFixed(2)}/${interval} (${price.id})`);
  return price;
}

async function findOrCreatePortal(products: { product: string; prices: string[] }[]) {
  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: { enabled: true, allowed_updates: ["email", "address"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      proration_behavior: "create_prorations",
      products,
    },
  };
  const existing = (await stripe.billingPortal.configurations.list({ active: true, limit: 100 })).data.find((c) => c.metadata?.app === APP);
  if (existing) {
    await stripe.billingPortal.configurations.update(existing.id, { features });
    console.log(`✓ customer portal configuration updated (${existing.id})`);
    return existing;
  }
  const created = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "Manage your Flyer Studio subscription" },
    features,
    metadata: { app: APP },
  });
  console.log(`+ created customer portal configuration (${created.id})`);
  return created;
}

/** Replace or append KEY=value lines in .env.local, leaving every other line untouched. */
function writeEnv(values: Record<string, string>) {
  let text = readFileSync(ENV_FILE, "utf8");
  for (const [name, value] of Object.entries(values)) {
    const line = new RegExp(`^${name}=.*$`, "m");
    text = line.test(text) ? text.replace(line, `${name}=${value}`) : `${text.replace(/\s*$/, "\n")}${name}=${value}\n`;
  }
  writeFileSync(ENV_FILE, text);
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}
