/**
 * Security headers. The Content-Security-Policy allows only what the app talks to: our own
 * origin (API, uploads), the public storage bucket (R2 custom domain), Unsplash (photos)
 * and — when configured — PostHog and Sentry. Paynow is a full-page redirect, so it needs
 * no entry. The CSP is set per request by proxy.ts (it reads runtime configuration); the
 * rest are static and set for every route in next.config.ts.
 *
 * Scripts keep 'unsafe-inline' because Next.js streams inline bootstrap scripts and a
 * nonce would force every page to render dynamically; the policy still blocks foreign
 * script hosts, plugins, framing, base-tag hijacking and exfiltration to unknown hosts.
 */

/** HTTPS-only headers make no sense on a plain-http site (localhost, a first docker run): they would break it. */
function servedOverHttps(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV === "production" && (env.BETTER_AUTH_URL || env.NEXT_PUBLIC_SITE_URL || "").startsWith("https://");
}

function origin(value: string | undefined) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(env: NodeJS.ProcessEnv = process.env) {
  const dev = env.NODE_ENV !== "production";
  const storage = origin(env.STORAGE_PUBLIC_URL);
  const posthog = env.NEXT_PUBLIC_POSTHOG_KEY ? env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com" : null;
  const sentry = env.NEXT_PUBLIC_SENTRY_DSN ? "https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io" : null;

  const directives: Record<string, (string | null | false)[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", dev && "'unsafe-eval'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", storage, "https://images.unsplash.com https://plus.unsplash.com", dev && "https://picsum.photos https://fastly.picsum.photos"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", storage, "https://images.unsplash.com", posthog, sentry, dev && "ws://localhost:* ws://127.0.0.1:* https://picsum.photos https://fastly.picsum.photos"],
    "frame-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "media-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    ...(servedOverHttps(env) ? { "upgrade-insecure-requests": [] } : {}),
  };

  return Object.entries(directives)
    .map(([name, values]) => [name, ...values.filter(Boolean)].join(" "))
    .join("; ");
}

export function securityHeaders(env: NodeJS.ProcessEnv = process.env) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()" },
    ...(servedOverHttps(env) ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
  ];
}
