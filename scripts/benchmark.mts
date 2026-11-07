/**
 * Design-quality benchmark (Phase 1). Generates three directions for each of 100 real
 * prompts in every format and grades them with the design lint (lib/design/lint.ts).
 *   pnpm benchmark                       rules director, all formats, lint only (CI gate: 0 errors)
 *   pnpm benchmark --render              also writes contact sheets + an HTML report to benchmark-report/
 *   pnpm benchmark --live --limit 10     configured art director + stock photos (paced for free tiers)
 *   pnpm benchmark --formats poster      one format only
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FlyerDoc, FlyerFormat } from "@/lib/canvas/types";
import { decorForVariant, rankedChoices, rulesBrief, toDesignCopy, type DesignBrief } from "@/lib/design/brief";
import { chooseVariants, composeDesign, hasRichCopy } from "@/lib/design/compose";
import { lintDoc, type LintCode } from "@/lib/design/lint";

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const live = args.includes("--live");
const render = args.includes("--render");
const limit = Number(arg("limit") ?? (live ? 10 : 100));
const formats = (arg("formats")?.split(",") ?? (live ? ["poster"] : ["poster", "square", "story", "landscape"])) as FlyerFormat[];
const root = join(import.meta.dirname, "..");
const prompts = (JSON.parse(readFileSync(join(import.meta.dirname, "benchmark", "prompts.json"), "utf8")) as string[]).slice(0, limit);

interface Row {
  prompt: string;
  format: FlyerFormat;
  direction: string;
  score: number;
  errors: number;
  warnings: number;
  issues: string[];
}

const rows: Row[] = [];
const sheets: { prompt: string; format: FlyerFormat; file: string; scores: number[] }[] = [];
const byCode = new Map<LintCode, number>();
const started = Date.now();

if (render) mkdirSync(join(root, "benchmark-report"), { recursive: true });

for (const [index, prompt] of prompts.entries()) {
  let brief: DesignBrief;
  let photoSets: Awaited<ReturnType<typeof import("@/lib/design/photos").photosForBrief>> | null = null;
  if (live) {
    const { directDesign } = await import("@/lib/design/director");
    brief = (await directDesign(prompt, formats[0]!)).brief;
  } else {
    brief = rulesBrief(prompt);
  }
  const copy = toDesignCopy(brief);
  const choices = rankedChoices(brief);

  for (const format of formats) {
    if (live && !photoSets) {
      const { photosForBrief } = await import("@/lib/design/photos");
      photoSets = await photosForBrief(brief.photoQueries, format, 3);
    }
    const sets = photoSets ?? [[], [], []];
    const variants = chooseVariants(choices, { hasPhotos: sets.every((s) => s.length > 0), richCopy: hasRichCopy(copy) });
    const docs: FlyerDoc[] = variants.map((variant, i) =>
      composeDesign({ format, copy, variant, photos: sets[i] ?? [], decor: decorForVariant(choices.decor, i), brandColor: choices.brandColor, accentColor: choices.accentColor }),
    );
    const scores: number[] = [];
    docs.forEach((doc, i) => {
      const result = lintDoc(doc);
      scores.push(result.score);
      for (const issue of result.issues) byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);
      rows.push({
        prompt,
        format,
        direction: `${variants[i]!.archetype}/${variants[i]!.palette}/${variants[i]!.pairing}`,
        score: result.score,
        errors: result.errors,
        warnings: result.warnings,
        issues: result.issues.map((x) => `${x.severity === "error" ? "✗" : "!"} ${x.code}: ${x.message}`),
      });
    });
    if (render) {
      const { renderSheet } = await import("@/lib/render/png");
      const file = `${String(index + 1).padStart(3, "0")}-${format}.png`;
      writeFileSync(join(root, "benchmark-report", file), (await renderSheet(docs)).png);
      sheets.push({ prompt, format, file, scores });
    }
  }
  if (live && index < prompts.length - 1) await new Promise((resolve) => setTimeout(resolve, 9000)); // free-tier pacing
  if (process.stdout.isTTY) process.stdout.write(`\r  ${index + 1}/${prompts.length} prompts`);
}

const designs = rows.length;
const errors = rows.reduce((n, r) => n + r.errors, 0);
const warnings = rows.reduce((n, r) => n + r.warnings, 0);
const mean = rows.reduce((n, r) => n + r.score, 0) / Math.max(1, designs);
const clean = rows.filter((r) => r.errors === 0 && r.warnings === 0).length;

console.log(`\n\n${designs} designs (${prompts.length} prompts × ${formats.length} format${formats.length > 1 ? "s" : ""} × 3 directions) in ${((Date.now() - started) / 1000).toFixed(1)}s — ${live ? "live art director" : "rules director"}`);
console.log(`lint score ${mean.toFixed(1)}/100 · ${clean} spotless (${((clean / designs) * 100).toFixed(0)}%) · ${errors} errors · ${warnings} warnings`);
for (const [code, count] of [...byCode].sort((a, b) => b[1] - a[1])) console.log(`  ${code.padEnd(16)} ${count}`);

const worst = rows.filter((r) => r.issues.length).sort((a, b) => a.score - b.score).slice(0, 12);
if (worst.length) {
  console.log("\nlowest scores:");
  for (const r of worst) console.log(`  ${String(r.score).padStart(3)}  ${r.format.padEnd(9)} ${r.direction.padEnd(46)} “${r.prompt.slice(0, 40)}”\n        ${r.issues.slice(0, 3).join("\n        ")}`);
}

if (render) {
  const cards = sheets
    .map((s) => `<figure><img src="${s.file}" loading="lazy"><figcaption><b>${s.prompt.replace(/</g, "&lt;")}</b><br>${s.format} · lint ${s.scores.join(" / ")}</figcaption></figure>`)
    .join("");
  writeFileSync(
    join(root, "benchmark-report", "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Flyer Studio benchmark</title><style>body{font:14px -apple-system,Segoe UI,sans-serif;background:#f5f5f7;margin:24px}figure{margin:0 0 28px}img{max-width:100%;border-radius:8px}figcaption{color:#555;margin-top:6px}</style><h1>Benchmark · ${designs} designs · lint ${mean.toFixed(1)}</h1>${cards}`,
  );
  console.log(`\nreport: benchmark-report/index.html`);
}

writeFileSync(join(root, "benchmark-report.json"), JSON.stringify({ designs, errors, warnings, mean, clean, byCode: Object.fromEntries(byCode), live, formats, at: new Date().toISOString() }, null, 2));
// CI gate: nothing objectively broken.
process.exit(errors > 0 ? 1 : 0);
