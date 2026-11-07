import { z } from "zod";

import type { FlyerDoc } from "@/lib/canvas/types";
import type { DesignBrief } from "@/lib/design/brief";
import { askOpenModel, openModelConfig, openModelConfigs, type OpenModelConfig } from "@/lib/design/open-model";
import { log } from "@/lib/log";
import { renderSheet } from "@/lib/render/png";

/**
 * The creative director's review (Phase 1): the three directions are rendered on one
 * contact sheet and a vision model scores each against a design rubric, names what is
 * visibly wrong, and picks fixes the layout engine can apply. One wide sheet costs the
 * model far fewer tokens than three portrait images (see docs/ROADMAP.md).
 */

export const FIXES = ["swap_palette", "swap_layout", "swap_type", "trim_copy", "less_decor", "more_decor", "drop_photos"] as const;
export type Fix = (typeof FIXES)[number];

const score = z.number().describe("1–10");
const ReviewSchema = z.object({
  design: z.number().int().describe("The design's number on the sheet (1, 2 or 3)."),
  scores: z.object({ hierarchy: score, legibility: score, composition: score, color: score, brief: score, polish: score }),
  problems: z.array(z.string()).describe("Up to two concrete problems you can see, each under 12 words."),
  fixes: z.array(z.enum(FIXES)).describe("Up to two fixes that would most improve it; empty if it is already strong."),
});
export const CritiqueSchema = z.object({ designs: z.array(ReviewSchema) });

export type Review = z.infer<typeof ReviewSchema> & {
  overall: number;
  /** Set when this direction is a revision the side-by-side comparison preferred. */
  revision?: { from: number; reason: string };
};

const WEIGHTS = { hierarchy: 0.2, legibility: 0.2, composition: 0.2, color: 0.1, brief: 0.15, polish: 0.15 } as const;

export function overall(scores: Review["scores"]) {
  return Math.round(Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + scores[key as keyof typeof WEIGHTS] * weight, 0) * 10) / 10;
}

const SYSTEM = `You are the creative director of a design studio, reviewing flyer designs on a contact sheet before they go to the client. The designs are numbered on the sheet.

Score each design from 1 to 10 on:
- hierarchy: one clear focal point; the eye reads headline → key details → call to action.
- legibility: every word readable at a glance; nothing too small, cramped or low-contrast.
- composition: balance, alignment, rhythm and purposeful white space; nothing awkwardly empty or crowded.
- color: harmony and mood fit for the subject and audience.
- brief: honours the client's request (subject, mood, requested colours, imagery and words).
- polish: looks professionally finished — no awkward line breaks (a lone short word on a line), collisions, clipped text, clashing decoration or empty-looking areas.

Be a strict, experienced critic: 9–10 is portfolio quality, 7–8 is good, 5–6 is acceptable but flawed, 4 or below is broken. Score what you SEE, not what the design intends.

List up to two concrete, visible problems per design, each under 12 words. Then choose at most two fixes that would most improve it, from:
- swap_palette: the colours fight the mood, or the palette is dull or clashing.
- swap_layout: the structure suits the content badly (crowded, unbalanced, or empty).
- swap_type: the typefaces have the wrong voice or set poorly (bad breaks, cramped).
- trim_copy: too much text; the design needs to breathe.
- less_decor: decoration clutters or distracts.
- more_decor: the design feels bare or flat and needs energy.
- drop_photos: the photographs hurt the design (off-topic, low quality, or clashing).
Give an empty list when the design is already strong.`;

function coerce(raw: unknown) {
  const designs = Array.isArray((raw as { designs?: unknown })?.designs) ? (raw as { designs: unknown[] }).designs : [];
  const clamp = (n: unknown) => Math.min(10, Math.max(1, Number(n) || 5));
  return {
    designs: designs.map((d) => {
      const r = (d ?? {}) as Record<string, unknown>;
      const s = (r.scores ?? {}) as Record<string, unknown>;
      return {
        design: Math.round(Number(r.design) || 0),
        scores: { hierarchy: clamp(s.hierarchy), legibility: clamp(s.legibility), composition: clamp(s.composition), color: clamp(s.color), brief: clamp(s.brief), polish: clamp(s.polish) },
        problems: (Array.isArray(r.problems) ? r.problems : []).map(String).slice(0, 2),
        fixes: (Array.isArray(r.fixes) ? r.fixes : []).filter((f): f is Fix => (FIXES as readonly string[]).includes(String(f))).slice(0, 2),
      };
    }),
  };
}

function briefSummary(brief: DesignBrief) {
  const c = brief.copy;
  return [
    `Client request category: ${brief.category.replace("_", " ")}; audience: ${brief.audience}; mood: ${brief.tone.join(", ") || "—"}.`,
    brief.requirements.length ? `Must honour: ${brief.requirements.join("; ")}.` : "",
    `Headline: "${c.headline}"${c.subhead ? `; subhead: "${c.subhead}"` : ""}${c.cta ? `; call to action: "${c.cta}"` : ""}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The critic's own vision model (CRITIC_PROVIDER / CRITIC_API_KEY / CRITIC_MODEL) first —
 * free tiers meter output per model per minute, and the art director spends most of it —
 * then the art director's models. Each must accept images.
 */
function criticConfigs() {
  return [openModelConfig(process.env, "CRITIC_"), ...openModelConfigs()].filter((c): c is OpenModelConfig => Boolean(c));
}

export function criticConfigured() {
  return process.env.CRITIC !== "off" && criticConfigs().length > 0;
}

/** One sheet, one question, each configured model in turn until one answers. */
async function ask<T>(png: Uint8Array, text: string, request: { system: string; name: string; schema: z.ZodType<T>; coerce: (raw: unknown) => unknown; maxTokens: number }) {
  for (const config of criticConfigs()) {
    const result = await askOpenModel(config, {
      ...request,
      content: [
        { type: "text", text },
        { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(png).toString("base64")}` } },
      ],
    });
    if (result.ok) return result.value;
    log.warn("critic.unavailable", { model: config.model, task: request.name, reason: result.reason.slice(0, 200) });
  }
  return null;
}

/**
 * Reviews the designs. Returns one review per doc (same order), or null when no vision
 * model is configured or the review failed — the caller keeps the designs as they are.
 */
export async function critique(docs: FlyerDoc[], brief: DesignBrief): Promise<Review[] | null> {
  if (!criticConfigured() || !docs.length) return null;
  const started = Date.now();
  const sheet = await renderSheet(docs);
  const value = await ask(sheet.png, `${briefSummary(brief)}\n\nReview the ${docs.length} numbered designs on this sheet.`, {
    system: SYSTEM,
    name: "design_critique",
    schema: CritiqueSchema,
    coerce,
    maxTokens: 500,
  });
  if (!value) return null;
  const reviews = docs.map((_, i) => {
    const found = value.designs.find((d) => d.design === i + 1) ?? value.designs[i];
    return found ? { ...found, design: i + 1, overall: overall(found.scores) } : null;
  });
  if (reviews.some((r) => !r)) {
    log.warn("critic.incomplete", { got: value.designs.length, expected: docs.length });
    return null;
  }
  log.info("critic.reviewed", { ms: Date.now() - started, scores: reviews.map((r) => r!.overall) });
  return reviews as Review[];
}

// ── Side-by-side comparison ─────────────────────────────────────────────────
// Absolute scores drift between reviews (an unchanged design scored 10, then 7.6), by
// more than a revision usually gains. Judging the original and its revision side by
// side, in one look, cancels that drift. The model isn't told which one is the revision.

const VerdictSchema = z.object({
  row: z.number().int().describe("The row number on the sheet."),
  a: score.describe("Version A overall, 1–10."),
  b: score.describe("Version B overall, 1–10."),
  better: z.enum(["A", "B", "same"]),
  reason: z.string().describe("Under 20 words: the visible difference that decided it."),
});
export const CompareSchema = z.object({ rows: z.array(VerdictSchema) });
export type Verdict = Omit<z.infer<typeof VerdictSchema>, "row">;

const COMPARE_SYSTEM = `You are the creative director of a design studio. Each numbered row of the sheet shows two versions of the same flyer: A on the left, B on the right. They differ in colour, layout, typefaces, copy or decoration.

For each row, decide which version is the better finished flyer for the client's brief, judging what you SEE: hierarchy, legibility, composition, colour, fit to the brief and polish. Score both 1–10 on the same scale (9–10 portfolio quality, 7–8 good, 5–6 flawed, 4 or below broken). Answer "same" only when neither is clearly better. Give the visible difference that decided it.`;

function coerceCompare(raw: unknown) {
  const rows = Array.isArray((raw as { rows?: unknown })?.rows) ? (raw as { rows: unknown[] }).rows : [];
  const clamp = (n: unknown) => Math.min(10, Math.max(1, Number(n) || 5));
  return {
    rows: rows.map((r) => {
      const v = (r ?? {}) as Record<string, unknown>;
      const better = String(v.better ?? "").trim().toUpperCase();
      return { row: Math.round(Number(v.row) || 0), a: clamp(v.a), b: clamp(v.b), better: better === "A" || better === "B" ? better : "same", reason: String(v.reason ?? "").slice(0, 200) };
    }),
  };
}

/** Judges each [original, revision] pair. One verdict per pair (same order), or null. */
export async function compare(pairs: [FlyerDoc, FlyerDoc][], brief: DesignBrief): Promise<Verdict[] | null> {
  if (!criticConfigured() || !pairs.length) return null;
  const started = Date.now();
  const first = pairs[0]![0];
  const sheet = await renderSheet(pairs.flat(), undefined, {
    columns: 2,
    cellWidth: first.width / first.height > 1.2 ? 560 : 380,
    labels: pairs.flatMap((_, r) => [`${r + 1}A`, `${r + 1}B`]),
  });
  const value = await ask(sheet.png, `${briefSummary(brief)}\n\nCompare A and B in each of the ${pairs.length} numbered rows.`, {
    system: COMPARE_SYSTEM,
    name: "design_compare",
    schema: CompareSchema,
    coerce: coerceCompare,
    maxTokens: 300,
  });
  if (!value) return null;
  const verdicts = pairs.map((_, i) => value.rows.find((r) => r.row === i + 1) ?? value.rows[i]);
  if (verdicts.some((v) => !v)) {
    log.warn("critic.incomplete", { task: "compare", got: value.rows.length, expected: pairs.length });
    return null;
  }
  log.info("critic.compared", { ms: Date.now() - started, verdicts: verdicts.map((v) => `${v!.better} ${v!.a}/${v!.b}`) });
  return verdicts.map((v) => ({ a: v!.a, b: v!.b, better: v!.better, reason: v!.reason }));
}
