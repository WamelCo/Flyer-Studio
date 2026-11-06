import Stripe from "stripe";

import { ApiException } from "@/lib/api/server";

let stripe: Stripe | null = null;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ApiException("PAYMENTS_NOT_CONFIGURED", "Payments aren't configured on this server yet.");
  stripe ??= new Stripe(key, { appInfo: { name: "Flyer Studio" }, maxNetworkRetries: 2 });
  return stripe;
}
