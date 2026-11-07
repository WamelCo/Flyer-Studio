/**
 * Phase 1 design-quality machinery, offline: the lint catches what it must, the server
 * renderer produces real images, fixes change what they should, and the review loop
 * (against a mock vision model) keeps a revision only when the side-by-side comparison
 * prefers it.
 *   pnpm test:design
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import type { FlyerDoc, TextNode } from "@/lib/canvas/types";
import { decorForVariant, rankedChoices, rulesBrief, toDesignCopy, type DesignBrief } from "@/lib/design/brief";
import { chooseVariants, composeDesign, hasRichCopy } from "@/lib/design/compose";
import { lintDoc } from "@/lib/design/lint";
import { applyFixes, reviewAndRefine, type RefineContext, type Slot } from "@/lib/design/refine";
import { ARCHETYPES } from "@/lib/design/archetypes";
import { PALETTES } from "@/lib/design/palettes";
import { PAIRINGS } from "@/lib/design/typography";
import { docToSvg } from "@/lib/render/svg";
import { renderPng, renderSheet } from "@/lib/render/png";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ── Lint ────────────────────────────────────────────────────────────────────
const page = (nodes: FlyerDoc["nodes"]): FlyerDoc => ({ version: 1, format: "poster", width: 1240, height: 1754, background: "#FFFFFF", nodes });
const t = (name: string, text: string, x: number, y: number, fontSize: number, width = 900): TextNode => ({
  id: name + x + y, name, type: "text", text, x, y, rotation: 0, opacity: 1, font: "sans", fontSize, fontWeight: 700, fill: "#111111", align: "left", width, lineHeight: 1.1, letterSpacing: 0,
});

console.log("lint");
await test("a clean page scores 100", () => {
  const result = lintDoc(page([t("Headline", "Summer Jazz", 120, 200, 120), t("Subhead", "An evening of soul", 120, 400, 40)]));
  assert.deepEqual(result.issues, []);
  assert.equal(result.score, 100);
});
await test("text off the page and colliding text are errors", () => {
  const result = lintDoc(
    page([
      t("Headline", "Jazz", 120, 200, 160),
      t("Subhead", "Tonight", 150, 230, 120),
      t("Details", "Past the edge", 1000, 1000, 60, 600),
    ]),
  );
  const codes = result.issues.map((i) => i.code).sort();
  assert.deepEqual(codes, ["text_off_page", "text_overlap"]);
  assert.equal(result.errors, 2);
  assert.equal(result.score, 50);
});
await test("the script-over-headline lockup and same-line headline runs are allowed", () => {
  const lockup = lintDoc(page([t("Script", "Join us", 300, 180, 90, 600), t("Headline", "JAZZ NIGHT", 120, 230, 160, 1000)]));
  assert.equal(lockup.issues.filter((i) => i.code === "text_overlap").length, 0);
  const runs = lintDoc(page([t("Headline", "Summer", 120, 200, 120, 420), t("Headline emphasis", "Jazz", 520, 200, 120, 300)]));
  assert.equal(runs.issues.filter((i) => i.code === "text_overlap").length, 0);
});
await test("tiny text, empty frames and a weak hierarchy are warnings", () => {
  const result = lintDoc(
    page([
      t("Headline", "Jazz", 120, 200, 60),
      t("Details", "Friday 8pm", 120, 600, 90),
      t("Fine print", "tiny", 120, 900, 8),
      { id: "img", name: "Photo slot", type: "image", src: "", x: 100, y: 1100, width: 400, height: 400, rotation: 0, opacity: 1, cornerRadius: 0 },
    ]),
  );
  const codes = result.issues.map((i) => i.code).sort();
  assert.deepEqual(codes, ["empty_frame", "tiny_text", "weak_hierarchy"]);
  assert.equal(result.errors, 0);
  assert.equal(result.score, 85);
});

// ── Rendering ───────────────────────────────────────────────────────────────
const brief: DesignBrief = rulesBrief("Kids birthday party for Mia turning 6, Saturday 2pm");
const copy = toDesignCopy(brief);
const choices = rankedChoices(brief);
const variants = chooseVariants(choices, { hasPhotos: false, richCopy: hasRichCopy(copy) });
const docs = variants.map((variant, i) => composeDesign({ format: "poster", copy, variant, photos: [], decor: decorForVariant(choices.decor, i) }));

console.log("server rendering");
await test("SVG carries every text line with the right font family", () => {
  const svg = docToSvg(docs[0]!);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  for (const node of docs[0]!.nodes.filter((n): n is TextNode => n.type === "text")) {
    for (const line of (node.uppercase ? node.text.toUpperCase() : node.text).split("\n")) assert.ok(svg.includes(line.replace(/&/g, "&amp;").replace(/'/g, "'")), line);
  }
  assert.doesNotMatch(svg, /NaN|undefined/);
});
await test("renders real PNGs: a design, and a wide contact sheet (grid for landscape)", async () => {
  const png = await renderPng(docs[0]!, 300);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  const sheet = await renderSheet(docs);
  assert.ok(sheet.width > sheet.height, "portrait designs sit in one wide row");
  const landscape = variants.map((variant, i) => composeDesign({ format: "landscape", copy, variant, photos: [], decor: decorForVariant(choices.decor, i) }));
  const grid = await renderSheet(landscape);
  assert.ok(grid.width > grid.height && grid.height > 600, "landscape designs sit in a 2-column grid");
});

// ── Fixes ───────────────────────────────────────────────────────────────────
const ctx: RefineContext = { brief, choices, format: "poster", colours: { brandColor: null, accentColor: null }, richCopy: hasRichCopy(copy) };
const slots: Slot[] = variants.map((variant, i) => ({
  doc: docs[i]!,
  variant,
  photos: [],
  decor: decorForVariant(choices.decor, i),
  copy,
  label: { layout: ARCHETYPES[variant.archetype].name, palette: PALETTES[variant.palette].name, type: PAIRINGS[variant.pairing].name },
}));

console.log("fixes");
await test("swap_palette, swap_type and swap_layout pick options no other direction uses", () => {
  const others = slots.slice(1);
  // Rich copy opens the sectioned layouts, so there is a free one to swap to.
  const fixed = applyFixes(slots[0]!, ["swap_palette", "swap_type", "swap_layout"], others, { ...ctx, richCopy: true })!;
  assert.ok(fixed);
  for (const key of ["palette", "pairing", "archetype"] as const) {
    assert.notEqual(fixed.variant![key], slots[0]!.variant![key], key);
    assert.ok(!others.some((o) => o.variant![key] === fixed.variant![key]), `${key} is not already used`);
  }
});
await test("known gap: no photos + a one-line message leaves only 2 usable layouts (Phase 1 layouts milestone)", () => {
  // Update this when the layout library grows: three directions should then get three layouts.
  assert.equal(new Set(variants.map((v) => v.archetype)).size, 2);
  assert.equal(applyFixes(slots[0]!, ["swap_layout"], slots.slice(1), ctx), null, "nowhere to swap to");
});
await test("trim_copy and decor fixes change only what they should; no-op fixes return null", () => {
  const rich = { ...slots[0]!, copy: { ...copy, body: "A long paragraph.", bodyTitle: "Why", bullets: ["a", "b", "c", "d"] } };
  const trimmed = applyFixes(rich, ["trim_copy"], slots.slice(1), ctx)!;
  assert.equal(trimmed.copy.body, null);
  assert.equal(trimmed.copy.bullets.length, 2);
  assert.equal(trimmed.variant!.archetype, rich.variant!.archetype);
  const calmer = applyFixes({ ...slots[0]!, decor: { level: "minimal", motifs: ["confetti"] } }, ["less_decor"], slots.slice(1), ctx)!;
  assert.deepEqual(calmer.decor.motifs, []);
  assert.equal(applyFixes(slots[0]!, [], slots.slice(1), ctx), null);
  assert.equal(applyFixes({ ...slots[0]!, variant: null }, ["swap_palette"], slots.slice(1), ctx), null, "the Ideogram lead is never re-composed");
});

// ── Review loop against a mock vision model ─────────────────────────────────
type Handler = (call: number, body: Record<string, unknown>) => unknown;
let handler: Handler = () => ({});
let calls = 0;
const server = createServer(async (req: IncomingMessage, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  calls++;
  const body = JSON.parse(raw) as Record<string, unknown>;
  const reply = handler(calls, body);
  res.writeHead(reply === "error" ? 503 : 200, { "content-type": "application/json" });
  res.end(JSON.stringify(reply === "error" ? { error: "down" } : { choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }] }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
Object.assign(process.env, { LLM_PROVIDER: "custom", LLM_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, LLM_MODEL: "mock-vl", LLM_API_KEY: "k" });
delete process.env.LLM_FALLBACK_PROVIDER;
const review = (design: number, all: number, fixes: string[] = []) => ({
  design,
  scores: { hierarchy: all, legibility: all, composition: all, color: all, brief: all, polish: all },
  problems: fixes.length ? ["the palette fights the mood"] : [],
  fixes,
});
const quiet = console.info;
console.info = () => undefined;
const reset = (h: Handler) => {
  handler = h;
  calls = 0;
};

console.log("review loop (mock vision model)");
await test("sends one contact sheet image per review", async () => {
  let image = "";
  reset((_, body) => {
    const user = (body.messages as { content: unknown }[])[1]!.content as { type: string; image_url?: { url: string } }[];
    image = user.find((p) => p.type === "image_url")?.image_url?.url ?? "";
    return { designs: [review(1, 9), review(2, 9), review(3, 9)] };
  });
  await reviewAndRefine(slots, ctx);
  assert.match(image, /^data:image\/png;base64,iVBOR/);
  assert.equal(calls, 1, "strong designs need no second review");
});
const verdict = (row: number, a: number, b: number, better: "A" | "B" | "same") => ({ row, a, b, better, reason: "calmer colours suit the mood" });
const userText = (body: Record<string, unknown>) => ((body.messages as { content: unknown }[])[1]!.content as { type: string; text?: string }[])[0]!.text ?? "";

await test("a revision the side-by-side comparison prefers is kept, scored by the difference; strongest leads", async () => {
  let asked = "";
  reset((call, body) => {
    if (call === 1) return { designs: [review(1, 9), review(2, 6, ["swap_palette"]), review(3, 7)] };
    asked = userText(body);
    return { rows: [verdict(1, 5, 7, "B")] };
  });
  const out = await reviewAndRefine(slots, ctx);
  assert.equal(calls, 2);
  assert.match(asked, /Compare A and B in each of the 1 numbered rows/);
  const fixed = out.find((s) => s.review!.revision)!;
  assert.equal(fixed.review!.overall, 8, "6 + (7 − 5)");
  assert.deepEqual(fixed.review!.revision, { from: 6, reason: "calmer colours suit the mood" });
  assert.notEqual(fixed.variant!.palette, slots[1]!.variant!.palette);
  assert.deepEqual(out.map((s) => s.review!.overall), [9, 8, 7]);
});
await test("a revision is discarded when the original wins, it's a tie, or the scores contradict the pick", async () => {
  for (const v of [verdict(1, 7, 5, "A"), verdict(1, 6, 6, "same"), verdict(1, 7, 6, "B")]) {
    reset((call) => (call === 1 ? { designs: [review(1, 9), review(2, 6, ["swap_palette"]), review(3, 7)] } : { rows: [v] }));
    const out = await reviewAndRefine(slots, ctx);
    const kept = out.find((s) => s.review!.overall === 6)!;
    assert.equal(kept.variant!.palette, slots[1]!.variant!.palette, JSON.stringify(v));
    assert.equal(kept.review!.revision, undefined);
  }
});
await test("a weak Ideogram lead is replaced by an engine design when the comparison agrees", async () => {
  const withLead = [{ ...slots[0]!, variant: null, label: { layout: "Ideogram design", palette: "x", type: "y" } }, ...slots.slice(1)];
  reset((call) => (call === 1 ? { designs: [review(1, 4), review(2, 9), review(3, 9)] } : { rows: [verdict(1, 4, 8, "B")] }));
  const out = await reviewAndRefine(withLead, ctx);
  assert.ok(out.every((s) => s.variant), "no Ideogram slot left");
  assert.ok(out.some((s) => s.review!.overall === 8));
});
await test("if the comparison fails, the originals stand (still ranked by the first review)", async () => {
  const errors = console.warn;
  console.warn = () => undefined;
  reset((call) => (call === 1 ? { designs: [review(1, 6, ["swap_palette"]), review(2, 9), review(3, 7)] } : "error"));
  const out = await reviewAndRefine(slots, ctx);
  console.warn = errors;
  assert.deepEqual(out.map((s) => s.doc), [slots[1]!.doc, slots[2]!.doc, slots[0]!.doc]);
});
await test("with the vision model down, designs come back unchanged (and unranked)", async () => {
  reset(() => "error");
  const errors = console.warn;
  console.warn = () => undefined;
  const out = await reviewAndRefine(slots, ctx);
  console.warn = errors;
  assert.deepEqual(out.map((s) => s.doc), slots.map((s) => s.doc));
  assert.ok(out.every((s) => !s.review));
});

console.info = quiet;
server.close();
console.log(`\n${passed} passed`);
