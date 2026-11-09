/**
 * Browser-side Sentry, only when NEXT_PUBLIC_SENTRY_DSN is set at build time. The SDK is
 * a separate chunk fetched after start-up, so it never delays first paint; without a
 * DSN the import is dead code and never fetched.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) =>
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.1),
    }),
  );
}
