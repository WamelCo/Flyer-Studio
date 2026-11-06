import { NextResponse } from "next/server";

import { ApiException, handle, requireUser } from "@/lib/api/server";
import { getProfile } from "@/lib/db/credits";
import { siteUrl } from "@/lib/env";
import { getStripe } from "@/lib/stripe/server";

/** Stripe Customer Portal for managing an existing subscription (per pricing rules). */
export const POST = handle(async () => {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  if (!profile.stripe_customer_id) {
    throw new ApiException("NOT_FOUND", "There's no subscription to manage yet.");
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${siteUrl()}/billing`,
    // Created by `pnpm stripe:setup` (plan switching between Pro and Max, cancel at period end).
    // Without it Stripe uses the account's default portal configuration.
    configuration: process.env.STRIPE_PORTAL_CONFIGURATION || undefined,
  });
  return NextResponse.json({ url: session.url });
});
