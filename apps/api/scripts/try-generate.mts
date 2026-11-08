/**
 * Runs the generate route's design pipeline (design-pipeline.ts) end to end — art director,
 * engine layouts, renderer, fallback — with local files standing in for R2 and no database.
 *
 *   pnpm --filter @flyer/api generate:try -- "<prompt>" [--format poster] [--out dir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import type { FlyerFormat } from "@flyer/core/canvas/types";

import { designFlyers } from "../src/design-pipeline";
import { renderingEnabled } from "../src/render";

const { values, positionals } = parseArgs({
  options: { format: { type: "string", default: "poster" }, out: { type: "string", default: "generate-out" } },
  allowPositionals: true,
});
const prompt = positionals.join(" ").trim();
if (!prompt) throw new Error('Usage: generate:try -- "<prompt>"');

const out = resolve(values.out!);
mkdirSync(out, { recursive: true });
console.log(`renderer: ${renderingEnabled() ? process.env.IDEOGRAM_MODEL || "ideogram-4-5" : "off (engine designs only)"}`);

const started = Date.now();
const result = await designFlyers(prompt, values.format as FlyerFormat, async (bytes, i) => {
  const file = join(out, `render-${i}.png`);
  writeFileSync(file, bytes);
  return pathToFileURL(file).href;
});

console.log(`director: ${result.source} · ${result.brief.category} · "${result.copy.headline}" · ${((Date.now() - started) / 1000).toFixed(1)}s`);
result.variants.forEach((variant, i) => {
  const render = result.renders?.[i];
  const status = !render ? "engine" : render.rendered ? `rendered (seed ${render.seed})` : `fell back to engine — ${render.error}`;
  console.log(`  ${i}: ${variant.archetype} · ${variant.palette} · ${variant.pairing} → ${status}`);
  writeFileSync(join(out, `design-${i}.json`), JSON.stringify(result.designs[i], null, 2));
  writeFileSync(join(out, `delivered-${i}.json`), JSON.stringify(result.docs[i], null, 2));
});
