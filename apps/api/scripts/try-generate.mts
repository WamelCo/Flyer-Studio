/**
 * Runs the generate flow's code end to end without a database: the design pipeline
 * (art director → three engine designs), then — like POST /api/generate/:jobId/render —
 * renders only the chosen design. Local files stand in for R2.
 *
 *   pnpm --filter @flyer/api generate:try -- "<prompt>" [--render 0|1|2] [--format poster] [--out dir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import type { FlyerFormat } from "@flyer/core/canvas/types";

import { designFlyers, renderMeta } from "../src/design-pipeline";
import { renderVariants } from "../src/render";

const { values, positionals } = parseArgs({
  options: {
    format: { type: "string", default: "poster" },
    out: { type: "string", default: "generate-out" },
    render: { type: "string" },
  },
  allowPositionals: true,
});
const prompt = positionals.join(" ").trim();
if (!prompt) throw new Error('Usage: generate:try -- "<prompt>" [--render 0|1|2]');

const out = resolve(values.out!);
mkdirSync(out, { recursive: true });

let started = Date.now();
const result = await designFlyers(prompt, values.format as FlyerFormat);
console.log(`designed in ${((Date.now() - started) / 1000).toFixed(1)}s · director ${result.source} · ${result.brief.category} · "${result.copy.headline}" · renderable ${result.renderable}`);
result.variants.forEach((variant, i) => {
  console.log(`  ${i}: ${variant.archetype} · ${variant.palette} · ${variant.pairing}`);
  writeFileSync(join(out, `design-${i}.json`), JSON.stringify(result.designs[i], null, 2));
  writeFileSync(join(out, `delivered-${i}.json`), JSON.stringify(result.docs[i], null, 2));
});

if (values.render !== undefined) {
  const index = Number(values.render);
  started = Date.now();
  const [render] = await renderVariants([result.designs[index]!], [renderMeta(result.brief, result.variants[index]!)], async (bytes) => {
    const file = join(out, `render-${index}.png`);
    writeFileSync(file, bytes);
    return pathToFileURL(file).href;
  });
  console.log(
    render?.rendered
      ? `rendered design ${index} in ${((Date.now() - started) / 1000).toFixed(1)}s (seed ${render.seed}) → ${join(out, `render-${index}.png`)}`
      : `design ${index} fell back to the engine design: ${render?.error}`,
  );
}
