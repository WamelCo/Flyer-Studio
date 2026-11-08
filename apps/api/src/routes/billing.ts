import type { BillingSummary } from "@flyer/core/api/contracts";
import { PLANS, stripePriceId } from "@flyer/core/stripe/plans";
import { getProfile, prisma } from "@flyer/db";
import { Hono } from "hono";
import { z } from "zod";

import { webUrl } from "../env";
import { ApiException, parseJson, type AppEnv } from "../http";
import { requireUser } from "../session";
import { getStripe } from "../stripe";

const Checkout = z.object({
  plan: z.enum(["pro", "max"]),
  interval: z.enum(["month", "year"]),
  theme: z.enum(["light", "dark"]).default("light"),
});

/**
 * Creates an Embedded Checkout session. The payment form renders inside our page;
 * the browser is never redirected to Stripe's hosted checkout.
 */
export const checkout = new Hono<AppEnv>().use(requireUser).post("/", async (c) => {
  const user = c.var.user;
  const { plan, interval, theme } = await parseJson(c, Checkout);

  const price = stripePriceId(plan, interval);
  if (!price) throw new ApiException("PAYMENTS_NOT_CONFIGURED", `No Stripe price is configured for ${PLANS[plan].name}.`);

  const profile = await getProfile(user.id, user.email);
  if (profile.stripeSubscriptionId && profile.plan !== "free") {
    throw new ApiException(
      "CONFLICT",
      `You're already subscribed to ${PLANS[profile.plan].name}. Change plans from Manage subscription.`,
      { currentPlan: profile.plan },
    );
  }

  const stripe = getStripe();

  // One Stripe customer per user, created up front so retries never duplicate it.
  let customerId = profile.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email: profile.email || user.email, metadata: { userId: user.id } },
      { idempotencyKey: `customer:${user.id}` },
    );
    customerId = customer.id;
    await prisma.profile.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  const dark = theme === "dark";
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded",
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    metadata: { userId: user.id, plan, interval },
    subscription_data: { metadata: { userId: user.id, plan } },
    redirect_on_completion: "if_required",
    return_url: `${webUrl()}/billing?session_id={CHECKOUT_SESSION_ID}`,
    // Match the app's tokens: SF stack, 8px button radius, accent, current colour scheme.
    branding_settings: {
      display_name: "Flyer Studio",
      font_family: "default",
      border_style: "rounded",
      button_color: "#0071E3",
      background_color: dark ? "#1C1C1E" : "#FFFFFF",
    },
  });

  if (!session.client_secret) throw new ApiException("INTERNAL_ERROR", "Stripe didn't return a checkout session.");
  return c.json({ clientSecret: session.client_secret });
});

export const billing = new Hono<AppEnv>()
  .use(requireUser)

  /** Plan, balance and the latest credit movements for the Billing page. */
  .get("/summary", async (c) => {
    const user = c.var.user;
    const [profile, ledger] = await Promise.all([
      getProfile(user.id, user.email),
      prisma.creditLedger.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, delta: true, reason: true, createdAt: true },
      }),
    ]);
    const summary: BillingSummary = {
      plan: profile.plan,
      credits: profile.credits,
      billingInterval: profile.billingInterval,
      currentPeriodEnd: profile.currentPeriodEnd?.toISOString() ?? null,
      ledger: ledger.map((entry) => ({
        id: entry.id.toString(),
        delta: entry.delta,
        reason: entry.reason,
        created_at: entry.createdAt.toISOString(),
      })),
    };
    return c.json(summary);
  })

  /** Stripe Customer Portal for managing an existing subscription (per pricing rules). */
  .post("/portal", async (c) => {
    const user = c.var.user;
    const profile = await getProfile(user.id, user.email);
    if (!profile.stripeCustomerId) throw new ApiException("NOT_FOUND", "There's no subscription to manage yet.");

    const session = await getStripe().billingPortal.sessions.create({
      customer: profile.stripeCustomerId,
      return_url: `${webUrl()}/billing`,
      // Created by `pnpm stripe:setup` (plan switching between Pro and Max, cancel at period end).
      // Without it Stripe uses the account's default portal configuration.
      configuration: process.env.STRIPE_PORTAL_CONFIGURATION || undefined,
    });
    return c.json({ url: session.url });
  });
