import type { Instrumentation } from "next";

/**
 * Server-side Sentry, only when a DSN is configured (see lib/monitoring.ts). Loaded
 * lazily, so a deployment without Sentry never imports the SDK.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
