import type { NextConfig } from "next";

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
};

export default nextConfig;
