import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { securityHeaders } from "./lib/security-headers";

const monorepoRoot = join(__dirname, "../..");

/**
 * One .env.local for the whole monorepo, at its root. Next only reads apps/web/.env* (and
 * caches that, so a second loadEnvConfig call is a no-op), so the root files are read here:
 * same order as Next's, and nothing already set — real environment, apps/web/.env* — is overridden.
 */
function loadRootEnv() {
  const mode = process.env.NODE_ENV === "production" ? "production" : "development";
  for (const name of [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"]) {
    const file = join(monorepoRoot, name);
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
    }
  }
}
loadRootEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A self-contained server for the Docker image (apps/web/Dockerfile).
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@flyer/ai", "@flyer/auth", "@flyer/billing", "@flyer/db", "@flyer/design", "@flyer/log", "@flyer/storage"],
  // Konva's Node entry optionally requires the native `canvas` package. The editor only
  // ever renders in the browser, so alias it away for the server bundle.
  turbopack: {
    root: monorepoRoot,
    resolveAlias: {
      canvas: "./lib/empty-module.ts",
    },
  },
  poweredByHeader: false,
  // The design critic renders flyers on the server: resvg is a native module (never
  // bundled) and needs the font files shipped alongside the generate route.
  serverExternalPackages: ["@resvg/resvg-js", "pg"],
  outputFileTracingIncludes: {
    "/api/generate": ["../../packages/design/assets/fonts/**"],
  },
  experimental: {
    // Uploads (images ≤ 10 MB, exports ≤ 50 MB) pass through the proxy to their route.
    proxyClientMaxBodySize: "55mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

// Source maps go to Sentry only when a token is configured (readable stack traces);
// otherwise the build is untouched.
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;
