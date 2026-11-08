/** Typed access to configuration. Missing values surface as explicit error codes, not crashes. */

/** The public web origin. Auth, OAuth callbacks and Stripe return URLs all live here. */
export function webUrl() {
  return (process.env.WEB_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export const isProduction = process.env.NODE_ENV === "production";
