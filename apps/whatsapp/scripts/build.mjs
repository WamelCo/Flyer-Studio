// Bundles the service into one file, dist/index.mjs: our workspace packages and every
// pure-JS dependency are compiled in. Only what can't be bundled stays in node_modules:
// whatsapp-web.js (drives Chromium through puppeteer) and resvg (a native module).
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "warning",
  // CommonJS dependencies bundled into ESM still call require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  external: ["whatsapp-web.js", "@resvg/resvg-js", "pg-native"],
});
console.log("built dist/index.mjs");
