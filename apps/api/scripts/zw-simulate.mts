/**
 * Simulates Zimbabwean business owners using the app: each scenario goes through the
 * generate pipeline (art director → three engine designs), then the chosen design is
 * rendered — exactly what POST /api/generate and /render do, minus database and R2.
 *
 *   pnpm --filter @flyer/api zw:simulate -- [--dry] [--only salon,solar] [--pick salon=1,solar=0] [--out dir]
 *
 * --dry lists each scenario's three directions without rendering anything.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ZW_SCENARIOS } from "../../../packages/core/scripts/zw-scenarios.mts";
import { designFlyers, renderMeta } from "../src/design-pipeline";
import { renderVariants } from "../src/render";

const { values } = parseArgs({
  options: {
    dry: { type: "boolean", default: false },
    only: { type: "string" },
    pick: { type: "string", default: "" },
    out: { type: "string", default: "zw-out" },
  },
});

const out = resolve(values.out!);
mkdirSync(out, { recursive: true });
const only = values.only ? new Set(values.only.split(",")) : null;
const picks = new Map(values.pick!.split(",").filter(Boolean).map((pair) => pair.split("=") as [string, string]));

for (const scenario of ZW_SCENARIOS.filter((s) => !only || only.has(s.id))) {
  const result = await designFlyers(scenario.prompt, scenario.format);
  const c = result.copy;
  console.log(`\n[${scenario.id}] ${scenario.owner} · ${scenario.format} · director ${result.source} · ${result.brief.category}`);
  console.log(`  "${c.eyebrow ?? ""}" / "${c.headline}" / ${c.subhead ?? "—"} / cta "${c.cta ?? ""}"`);
  result.variants.forEach((v, i) => console.log(`  ${i}: ${v.archetype} · ${v.palette} · ${v.pairing}`));
  writeFileSync(join(out, `${scenario.id}.brief.json`), JSON.stringify(result.brief, null, 2));
  if (values.dry) continue;

  const index = Number(picks.get(scenario.id) ?? 0);
  const started = Date.now();
  const [render] = await renderVariants([result.designs[index]!], [renderMeta(result.brief, result.variants[index]!, scenario.prompt)], async (bytes) => {
    const file = join(out, `${scenario.id}.png`);
    writeFileSync(file, bytes);
    return pathToFileURL(file).href;
  });
  console.log(
    render?.rendered
      ? `  rendered direction ${index} in ${((Date.now() - started) / 1000).toFixed(1)}s → ${join(out, `${scenario.id}.png`)}`
      : `  direction ${index} fell back to the engine design: ${render?.error}`,
  );
}
