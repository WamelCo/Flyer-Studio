/**
 * Security headers for every response (Phase 0). The Content-Security-Policy allows only
 * what the app actually talks to: Supabase (API, storage, realtime), Stripe (Embedded
 * Checkout), Unsplash (photos) and — when configured — PostHog and Sentry.
 *
 * Scripts keep 'unsafe-inline' because Next.js streams inline bootstrap scripts and a
 * nonce would force every page to render dynamically; the policy still blocks foreign
 * script hosts, plugins, framing, base-tag hijacking and exfiltration to unknown hosts.
 */

export function securityHeaders(env: NodeJS.ProcessEnv = process.env) {
  const dev = env.NODE_ENV !== "production";
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  const supabaseWs = supabase ? supabase.replace(/^http/, "ws") : null;
  const posthog = env.NEXT_PUBLIC_POSTHOG_KEY ? (env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com") : null;
  const sentry = env.NEXT_PUBLIC_SENTRY_DSN ? "https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io" : null;
  const stripe = "https://js.stripe.com https://*.js.stripe.com";

  const directives: Record<string, (string | null | false)[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", dev && "'unsafe-eval'", stripe],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", supabase, "https://images.unsplash.com https://plus.unsplash.com", "https://*.stripe.com", dev && "https://picsum.photos https://fastly.picsum.photos"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      supabase,
      supabaseWs,
      "https://api.stripe.com https://*.stripe.com",
      "https://images.unsplash.com",
      posthog,
      sentry,
      dev && "ws://localhost:* ws://127.0.0.1:* https://picsum.photos https://fastly.picsum.photos",
    ],
    "frame-src": [stripe, "https://hooks.stripe.com", "https://checkout.stripe.com"],
    "worker-src": ["'self'", "blob:"],
    "media-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    ...(dev ? {} : { "upgrade-insecure-requests": [] }),
  };

  const csp = Object.entries(directives)
    .map(([name, values]) => [name, ...values.filter(Boolean)].join(" "))
    .join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    // Stripe's wallet buttons (Apple Pay, Google Pay) need the Payment Request API in its frames.
    { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(self "https://js.stripe.com" "https://checkout.stripe.com")' },
    ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
  ];
}
