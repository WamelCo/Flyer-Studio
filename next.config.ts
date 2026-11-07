import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { securityHeaders } from "./lib/security-headers";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "localhost";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" },
      { protocol: "http", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" },
    ],
  },
  // Konva's Node entry optionally requires the native `canvas` package. The editor only
  // ever renders in the browser, so alias it away for the server bundle.
  turbopack: {
    resolveAlias: {
      canvas: "./lib/empty-module.ts",
    },
  },
  poweredByHeader: false,
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
