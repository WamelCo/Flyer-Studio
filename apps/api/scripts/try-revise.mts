/**
 * Runs revisions the way POST /api/projects/:id/revisions does, chained on one rendered
 * flyer, and measures each one: how much of the image changed and how much of that
 * change fell inside the elements the instruction named (the mask).
 *
 *   pnpm --filter @flyer/api revise:try -- --image render-0.png --design design-0.json \
 *     "Change the price to US$20" "Make the WhatsApp us button green" ["…"] [--quality low] [--out dir]
 *
 * Each revision costs one precise edit ($0.008 very_low · $0.03 low · $0.06 medium · $0.22 high).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { FlyerDoc } from "@flyer/core/canvas/types";
import { checkRender } from "@flyer/core/design/ideogram";
import sharp from "sharp";

import { pixelDiff, type PixelBox } from "../src/images";
import { editQuality, startRevision, type EditQuality } from "../src/revise";

const PRICE: Record<EditQuality, number> = { very_low: 0.008, low: 0.03, medium: 0.06, high: 0.22 };

const { values, positionals } = parseArgs({
  options: {
    image: { type: "string" },
    design: { type: "string" },
    quality: { type: "string" },
    out: { type: "string", default: "revise-out" },
  },
  allowPositionals: true,
});
if (!values.image || positionals.length === 0) throw new Error('Usage: revise:try -- --image render.png [--design design.json] "<instruction>" …');

const out = resolve(values.out!);
mkdirSync(out, { recursive: true });
const design: FlyerDoc | null = values.design ? JSON.parse(readFileSync(values.design, "utf8")) : null;
const quality = (values.quality as EditQuality | undefined) ?? editQuality();

/** The edited image with the mask boxes outlined, for eyeballing what was allowed to change. */
async function annotate(image: Uint8Array, boxes: PixelBox[], file: string) {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const rects = boxes
    .map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="#FF2D55" stroke-width="${Math.max(4, width / 250)}" stroke-dasharray="18 10"/>`)
    .join("");
  await sharp(image)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}</svg>`) }])
    .png()
    .toFile(file);
}

let source = new Uint8Array(readFileSync(values.image));
writeFileSync(join(out, "rev-0.png"), source);
const report: unknown[] = [];
let spent = 0;

for (const [i, instruction] of positionals.entries()) {
  const started = Date.now();
  const { generationId, targets } = await startRevision(source, instruction, design, quality);
  let result: Awaited<ReturnType<typeof checkRender>>;
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    result = await checkRender(generationId);
    if (result.status !== "pending") break;
    if (Date.now() - started > 10 * 60_000) throw new Error("revision timed out");
  }
  if (result.status === "failed") {
    console.log(`${i + 1}. "${instruction}" failed: ${result.reason}`);
    break;
  }
  const edited = new Uint8Array(await (await fetch(result.images[0]!.url)).arrayBuffer());
  const seconds = (Date.now() - started) / 1000;
  spent += PRICE[quality];
  const boxes = targets.map((t) => t.box);
  const diff = await pixelDiff(source, edited, boxes);
  writeFileSync(join(out, `rev-${i + 1}.png`), edited);
  await annotate(edited, boxes, join(out, `rev-${i + 1}-mask.png`));
  const entry = {
    revision: i + 1,
    instruction,
    targets: targets.map((t) => t.label),
    masked: boxes.length > 0,
    seconds: Number(seconds.toFixed(1)),
    changedPercent: Number((diff.changedShare * 100).toFixed(2)),
    insideTargetsPercent: diff.insideIntended === null ? null : Number((diff.insideIntended * 100).toFixed(1)),
    changedBox: diff.changedBox,
    costUsd: PRICE[quality],
  };
  report.push(entry);
  console.log(
    `${i + 1}. "${instruction}" → targets [${entry.targets.join(", ") || "none: unmasked"}] · ${seconds.toFixed(1)}s · ` +
      `${entry.changedPercent}% of pixels changed${entry.insideTargetsPercent === null ? "" : ` · ${entry.insideTargetsPercent}% of the change inside the targets`} · $${PRICE[quality]}`,
  );
  source = edited;
}

writeFileSync(join(out, "report.json"), JSON.stringify({ quality, spentUsd: Number(spent.toFixed(3)), revisions: report }, null, 2));
console.log(`spent $${spent.toFixed(3)} on ${report.length} revision(s) at ${quality} quality → ${out}`);
