import { defineConfig } from "tsup";

/**
 * Bundles the API and the workspace packages it imports (they ship TypeScript source)
 * into dist/index.js. npm dependencies stay external and are installed in the image.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@flyer\//],
  // @flyer/core's own dependencies, resolved from the API's node_modules at runtime.
  external: ["@anthropic-ai/sdk", "zod"],
});
