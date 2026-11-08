import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import path from "node:path";

// One .env at the repo root serves every app (Next runs with apps/web as its cwd).
const repoRoot = path.resolve(process.cwd(), "../..");
loadEnvConfig(repoRoot);

/** Where the Hono API listens, as seen from this server (http://api:4000 inside compose). */
const apiUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** Public R2 bucket host, so next/image can optimise project thumbnails. */
const r2Host = process.env.R2_PUBLIC_URL ? new URL(process.env.R2_PUBLIC_URL) : null;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@flyer/core"],
  images: {
    remotePatterns: r2Host
      ? [{ protocol: r2Host.protocol.replace(":", "") as "http" | "https", hostname: r2Host.hostname, pathname: "/**" }]
      : [],
  },
  // The browser talks to the API on this origin, so Better Auth cookies are first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  // Konva's Node entry optionally requires the native `canvas` package. The editor only
  // ever renders in the browser, so alias it away for the server bundle.
  turbopack: {
    resolveAlias: {
      canvas: "./lib/empty-module.ts",
    },
  },
};

export default nextConfig;
