import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { getProfile } from "@/lib/db/credits";
import { siteUrl } from "@/lib/env";
import { PLANS, stripePriceId } from "@/lib/stripe/plans";
import { getStripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";

const Body = z.object({
  plan: z.enum(["pro", "max"]),
  interval: z.enum(["month", "year"]),
  theme: z.enum(["light", "dark"]).default("light"),
});

/**
 * Creates an Embedded Checkout session. The payment form renders inside our page;
 * the browser is never redirected to Stripe's hosted checkout.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const { plan, interval, theme } = await parseJson(request, Body);

  const price = stripePriceId(plan, interval);
  if (!price) throw new ApiException("PAYMENTS_NOT_CONFIGURED", `No Stripe price is configured for ${PLANS[plan].name}.`);

  const profile = await getProfile(user.id);
  if (profile.stripe_subscription_id && profile.plan !== "free") {
    throw new ApiException(
      "CONFLICT",
      `You're already subscribed to ${PLANS[profile.plan].name}. Change plans from Manage subscription.`,
      { currentPlan: profile.plan },
    );
  }

  const stripe = getStripe();

  // One Stripe customer per user, created up front so retries never duplicate it.
  let customerId = profile.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email: profile.email || user.email, metadata: { userId: user.id } },
      { idempotencyKey: `customer:${user.id}` },
    );
    customerId = customer.id;
    await createAdminClient().from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
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
    return_url: `${siteUrl()}/billing?session_id={CHECKOUT_SESSION_ID}`,
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
  return NextResponse.json({ clientSecret: session.client_secret });
});
