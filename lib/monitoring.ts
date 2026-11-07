/**
 * Error reporting (Sentry) and product analytics (PostHog), both optional. Without their
 * keys every call here is a no-op and neither SDK is downloaded; with them, the SDK is
 * loaded lazily so it never weighs on first paint.
 *
 *   SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN   errors and traces (server / browser)
 *   NEXT_PUBLIC_POSTHOG_KEY (+ _HOST)      product analytics, cookieless (memory persistence)
 */

type Extra = Record<string, unknown>;

const serverDsn = () => process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Report an error that was handled (logged and recovered from) but still matters. */
export function reportError(error: unknown, extra?: Extra) {
  const dsn = typeof window === "undefined" ? serverDsn() : process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error, { extra })).catch(() => undefined);
}

// ── Browser analytics ───────────────────────────────────────────────────────

type PostHog = typeof import("posthog-js").default;
let posthog: Promise<PostHog | null> | null = null;

function client(): Promise<PostHog | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (typeof window === "undefined" || !key) return Promise.resolve(null);
  posthog ??= import("posthog-js")
    .then(({ default: ph }) => {
      ph.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        // No cookies or local storage: matches the privacy policy ("no analytics cookies").
        persistence: "memory",
        capture_pageview: false,
        autocapture: false,
        disable_session_recording: true,
        person_profiles: "identified_only",
      });
      return ph;
    })
    .catch(() => null);
  return posthog;
}

/** A product event, e.g. `track("generation_succeeded", { ms, lead })`. Never include prompts or PII. */
export function track(event: string, properties?: Extra) {
  void client().then((ph) => ph?.capture(event, properties));
}

export function trackPageview() {
  void client().then((ph) => ph?.capture("$pageview", { $current_url: window.location.origin + window.location.pathname }));
}

/** Ties events to the signed-in account by its opaque id (no email or name). */
export function identify(userId: string) {
  void client().then((ph) => ph?.identify(userId));
}
