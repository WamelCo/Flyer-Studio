/**
 * Renders engine-composed flyers through Ideogram and saves prompt + image for review.
 *
 *   pnpm --filter @flyer/core render:try -- --fixture health [--dry] [--quality medium|high]
 *                                          [--seed 123] [--out dir] [--tag name] [--budget 50]
 *
 * --dry compiles the prompt and asks Ideogram for a free price quote (nothing generated).
 * Real generations are counted in <out>/ledger.json and refused past --budget.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { FlyerFormat } from "../src/canvas/types";
import { ARCHETYPES } from "../src/design/archetypes";
import { decorForVariant, rankedChoices, toDesignCopy } from "../src/design/brief";
import { chooseVariants, composeDesign, hasRichCopy, type Variant } from "../src/design/compose";
import { directDesign } from "../src/design/director";
import type { StockPhoto } from "../src/design/engine";
import { renderFlyer } from "../src/design/ideogram";
import { FIXTURES, type Fixture } from "./render-fixtures.mts";
import { PALETTES } from "../src/design/palettes";
import { compileRenderPrompt, RENDER_SIZES } from "../src/design/render-prompt";
import { PAIRINGS } from "../src/design/typography";

const { values } = parseArgs({
  options: {
    fixture: { type: "string", multiple: true },
    dry: { type: "boolean", default: false },
    quality: { type: "string", default: "low" },
    seed: { type: "string" },
    out: { type: "string", default: "render-out" },
    tag: { type: "string", default: "" },
    budget: { type: "string", default: "50" },
    layout: { type: "string" },
    palette: { type: "string" },
    pairing: { type: "string" },
    format: { type: "string" },
    prompt: { type: "string" },
    variant: { type: "string" },
    negative: { type: "string", default: "prose" },
  },
  allowPositionals: true,
});

const out = resolve(values.out!);
mkdirSync(out, { recursive: true });
const ledgerFile = join(out, "ledger.json");
const ledger: { used: number; runs: { tag: string; fixture: string; file: string; seed: number; at: string }[] } = existsSync(ledgerFile)
  ? JSON.parse(readFileSync(ledgerFile, "utf8"))
  : { used: 0, runs: [] };
const budget = Number(values.budget);

// --prompt: the production path — art director brief → ranked choices → three variants.
if (values.prompt) {
  const format = (values.format as FlyerFormat) ?? "poster";
  const { brief, source } = await directDesign(values.prompt, format);
  const copy = toDesignCopy(brief);
  const choices = rankedChoices(brief);
  const variants = chooseVariants(choices, { count: 3, hasPhotos: true, richCopy: hasRichCopy(copy) });
  const index = Number(values.variant ?? 0);
  const variant = variants[index]!;
  console.log(`director: ${source} · category ${brief.category} · variants ${variants.map((v) => `${v.archetype}/${v.palette}/${v.pairing}`).join(", ")}`);
  FIXTURES.prompt = {
    subject: `${brief.category.replace("_", " ")} — ${brief.audience}`,
    tone: brief.tone,
    format,
    variant,
    decor: decorForVariant(choices.decor, index),
    copy,
    photos: brief.photoQueries,
  };
  values.fixture = ["prompt"];
}

const names = values.fixture?.length ? values.fixture : Object.keys(FIXTURES);
for (const name of names) {
  const base = FIXTURES[name];
  if (!base) throw new Error(`Unknown fixture ${name}. Try: ${Object.keys(FIXTURES).join(", ")}`);
  const fixture: Fixture = {
    ...base,
    format: (values.format as FlyerFormat) ?? base.format,
    variant: {
      archetype: (values.layout as Variant["archetype"]) ?? base.variant.archetype,
      palette: (values.palette as Variant["palette"]) ?? base.variant.palette,
      pairing: (values.pairing as Variant["pairing"]) ?? base.variant.pairing,
    },
  };

  // Placeholder photos make the engine lay out its frames; the renderer paints them.
  const stock: StockPhoto[] = Array.from({ length: Math.max(4, fixture.photos.length) }, (_, i) => ({
    url: `render://photo/${i}`,
    width: 1600,
    height: 1200,
    credit: { name: "render", url: "" },
  }));
  const doc = composeDesign({ format: fixture.format, copy: fixture.copy, variant: fixture.variant, photos: fixture.photos.length ? stock : [], decor: fixture.decor });
  const prompt = compileRenderPrompt(doc, {
    archetype: fixture.variant.archetype,
    palette: PALETTES[fixture.variant.palette],
    pairing: PAIRINGS[fixture.variant.pairing],
    subject: fixture.subject,
    tone: fixture.tone,
    photoPrompts: fixture.photos,
    negativeSpace: values.negative as "prose" | "boxes",
  });

  const stem = `${name}${values.tag ? `-${values.tag}` : ""}`;
  writeFileSync(join(out, `${stem}.prompt.json`), JSON.stringify(prompt, null, 2));
  writeFileSync(join(out, `${stem}.doc.json`), JSON.stringify(doc, null, 2));
  const chars = JSON.stringify(prompt).length;
  console.log(`\n${stem}: ${ARCHETYPES[fixture.variant.archetype].name} · ${fixture.variant.palette} · ${fixture.variant.pairing} · ${fixture.format}`);
  console.log(`  ${prompt.compositional_deconstruction.elements.length} elements, ${chars} chars, render ${RENDER_SIZES[fixture.format].width}x${RENDER_SIZES[fixture.format].height}`);

  if (values.dry) continue;
  if (ledger.used >= budget) {
    console.log(`  budget reached (${ledger.used}/${budget}) — skipped`);
    continue;
  }

  const started = Date.now();
  const [image] = await renderFlyer(prompt, fixture.format, {
    quality: values.quality as "low" | "medium" | "high",
    ...(values.seed && { seed: Number(values.seed) }),
  });
  ledger.used += 1;
  const file = `${stem}.png`;
  const bytes = Buffer.from(await (await fetch(image!.url)).arrayBuffer());
  writeFileSync(join(out, file), bytes);
  ledger.runs.push({ tag: values.tag ?? "", fixture: name, file, seed: image!.seed, at: new Date().toISOString() });
  writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
  console.log(`  rendered in ${((Date.now() - started) / 1000).toFixed(1)}s, seed ${image!.seed} → ${join(out, file)}  [${ledger.used}/${budget} used]`);
}
