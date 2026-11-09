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

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import type { FlyerDoc, FontKey, TextNode } from "@flyer/design/canvas/types";
import { agendaSteps } from "@flyer/design/archetypes/agenda";
import { menuItems } from "@flyer/design/archetypes/menu-board";
import { headlineFigure, splitPrice, splitTime } from "@flyer/design/archetypes/shared";
import { decorForVariant, rankedChoices, rulesBrief, toDesignCopy, type DesignBrief } from "../src/brief";
import { chooseVariants, composeDesign, hasRichCopy, layoutSuits } from "@flyer/design/compose";
import { styleOf, type DesignCopy, type StockPhoto } from "@flyer/design/engine";
import { lintDoc } from "@flyer/design/lint";
import { measure } from "@flyer/design/metrics";
import { applyFixes, reviewAndRefine, type RefineContext, type Slot } from "../src/refine";
import { ARCHETYPE_IDS, ARCHETYPES, type ArchetypeId } from "@flyer/design/archetypes";
import RENDER_FAMILIES from "@flyer/design/render/font-families.json";
import { PALETTES } from "@flyer/design/palettes";
import { PAIRINGS } from "@flyer/design/typography";
import { flyerDocSchema } from "@flyer/design/canvas/schema";
import { sourceCrop, treatPixels } from "@flyer/design/canvas/effects";
import { docToSvg } from "@flyer/design/render/svg";
import { renderPng, renderSheet, fontDir, watermarkSvg } from "@flyer/design/render/png";

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
await test("text tilted together is compared in its own frame: stacked lines pass, real collisions still fail", () => {
  const tilt = (node: TextNode) => ({ ...node, rotation: -4 });
  const stacked = lintDoc(page([tilt(t("Headline", "Summer jazz", 120, 300, 140, 1000)), tilt(t("Subhead", "An evening of soul", 130, 470, 60, 1000))]));
  assert.equal(stacked.issues.filter((i) => i.code === "text_overlap").length, 0);
  const colliding = lintDoc(page([tilt(t("Headline", "Summer jazz", 120, 300, 140, 1000)), tilt(t("Subhead", "An evening of soul", 140, 330, 90, 1000))]));
  assert.equal(colliding.issues.filter((i) => i.code === "text_overlap").length, 1);
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
await test("Free-plan renders (WhatsApp) carry the watermark inside the page, bottom right", async () => {
  const doc = docs[0]!;
  const mark = watermarkSvg(doc);
  assert.match(mark, /Made with Flyer Studio/);
  const [x, y, w, h] = ["x", "y", "width", "height"].map((attr) => Number(mark.match(new RegExp(` ${attr}="([\\d.]+)"`))![1]));
  assert.ok(x! > doc.width / 2 && y! > doc.height / 2 && x! + w! < doc.width && y! + h! < doc.height, "inside the page, bottom-right quadrant");
  const plain = await renderPng(doc, 300);
  const marked = await renderPng(doc, 300, undefined, { watermark: true });
  assert.notDeepEqual(Buffer.from(marked), Buffer.from(plain));
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
await test("no photos and a one-line message still get three different layouts, with room to swap", () => {
  assert.equal(new Set(variants.map((v) => v.archetype)).size, 3);
  const swapped = applyFixes(slots[0]!, ["swap_layout"], slots.slice(1), ctx)!;
  assert.ok(swapped && !slots.some((s) => s.variant!.archetype === swapped.variant!.archetype));
});

// ── Layout library ──────────────────────────────────────────────────────────
console.log("layout library");
const blankCopy: DesignCopy = { brand: null, eyebrow: null, headline: "", emphasis: null, subhead: null, bodyTitle: null, body: null, bullets: [], features: [], details: [], cta: null, contact: { phone: null, email: null, website: null, address: null, social: [] } };
const COPIES: Record<string, DesignCopy> = {
  short: { ...blankCopy, headline: "Grand opening" },
  event: {
    ...blankCopy,
    brand: "Blue Lotus",
    eyebrow: "Live on the rooftop",
    headline: "Summer jazz night",
    emphasis: "jazz",
    subhead: "An evening of soul and sax",
    details: [{ icon: "calendar", text: "Friday 14 November, 8pm" }, { icon: "ticket", text: "$15 at the door" }, { icon: "map-pin", text: "12 Admiralty Way, Lekki" }],
    cta: "Get tickets",
    contact: { ...blankCopy.contact, phone: "0803 123 4567", website: "bluelotus.ng", social: ["@bluelotus"] },
  },
  rich: {
    ...blankCopy,
    brand: "Mama Put Kitchen",
    eyebrow: "Lunch menu",
    headline: "Taste of home — 20% off this week",
    emphasis: "20%",
    subhead: "Cooked fresh every morning",
    body: "Everything is made from scratch with local produce, served hot from 11am until we sell out.",
    bullets: ["9:00 Doors open", "Jollof rice — ₦2,500", "Pepper soup — ₦3,000", "Suya platter — ₦4,500", "Chapman — ₦1,200"],
    features: [
      { title: "Fresh daily", text: "Made every morning.", icon: "leaf" },
      { title: "Local produce", text: "From farms nearby.", icon: "home" },
      { title: "Fast delivery", text: "Hot within 30 minutes.", icon: "zap" },
    ],
    details: [{ icon: "clock", text: "Open daily 11am–9pm" }, { icon: "map-pin", text: "4 Allen Avenue, Ikeja" }],
    cta: "Order on WhatsApp",
    contact: { ...blankCopy.contact, phone: "0803 555 0199", email: "hello@mamaput.ng", website: "mamaput.ng" },
  },
};
const fakePhotos: StockPhoto[] = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, url: `https://images.unsplash.com/photo-${i}?w=2000`, width: 1600, height: 1200, credit: { name: "x", url: "x" } }) as unknown as StockPhoto);

await test("every layout is lint-clean on short, event and rich copy, in every format, with and without photos", () => {
  const broken: string[] = [];
  for (const archetype of ARCHETYPE_IDS) {
    for (const [name, copy] of Object.entries(COPIES)) {
      for (const format of ["poster", "square", "story", "landscape"] as const) {
        for (const photos of [[], fakePhotos]) {
          const doc = composeDesign({ format, copy, variant: { archetype, palette: "trust-blue", pairing: "editorial" }, photos, decor: { level: "bold", motifs: ["dots", "sparkles", "rings"] } });
          const { errors, issues } = lintDoc(doc);
          if (errors) broken.push(`${archetype} · ${name} · ${format} · ${photos.length} photos: ${issues.map((i) => i.message).join("; ")}`);
        }
      }
    }
  }
  assert.deepEqual(broken, []);
});
await test("big numbers come from the copy, never from a phone number", () => {
  assert.equal(headlineFigure({ ...blankCopy, headline: "Everything 50% off" }), "50%");
  assert.equal(headlineFigure({ ...blankCopy, headline: "Mia turns 6!" }), "6");
  assert.equal(headlineFigure({ ...blankCopy, headline: "Suya night", subhead: "Call 0803 123 4567" }), null);
  assert.equal(headlineFigure({ ...blankCopy, headline: "Back to school", emphasis: "₦5,000 off" }), "₦5,000");
});
await test("prices and times are read as written, never made up", () => {
  assert.deepEqual(splitPrice("Jollof rice — ₦2,500"), { name: "Jollof rice", price: "₦2,500" });
  assert.deepEqual(splitPrice("Latte $4.50"), { name: "Latte", price: "$4.50" });
  assert.deepEqual(splitPrice("Free parking"), { name: "Free parking", price: null });
  assert.deepEqual(splitTime("9:00 Registration"), { time: "9:00", label: "Registration" });
  assert.deepEqual(splitTime("10am – Keynote"), { time: "10am", label: "Keynote" });
  assert.deepEqual(splitTime("Lunch with the team"), { time: null, label: "Lunch with the team" });
});
await test("the menu takes the list with prices, the agenda the list with times — not generic selling points", () => {
  const selling = [
    { title: "Local flavours", text: "Best of Lagos street food", icon: "utensils" as const },
    { title: "Live music", text: "Afrobeats from 6pm", icon: "headphones" as const },
  ];
  const copy = { ...blankCopy, features: selling, bullets: ["Jollof rice — ₦2,500", "Suya platter — ₦4,500", "Small chops — ₦3,000"] };
  assert.deepEqual(menuItems(copy).map((i) => i.price), ["₦2,500", "₦4,500", "₦3,000"]);
  assert.deepEqual(agendaSteps({ ...copy, bullets: ["9:00 Doors open", "12:00 Lunch", "18:00 Live band"] }).map((s) => s.time), ["9:00", "12:00", "18:00"]);
  assert.equal(menuItems({ ...copy, bullets: [] }).length, 2, "features still serve when they are the only list");
});
await test("layouts are only chosen when the copy suits them; quiet layouts cap their decoration", () => {
  const short = COPIES.short!;
  const ranked = { layouts: ["big-number", "menu-board", "agenda"] as ArchetypeId[], palettes: choices.palettes, pairings: choices.pairings };
  const picked = chooseVariants(ranked, { hasPhotos: false, richCopy: false, copy: short }).map((v) => v.archetype);
  for (const id of ["big-number", "menu-board", "agenda", "magazine-cover", "collage", "product-hero"]) assert.ok(!picked.includes(id as ArchetypeId), id);
  assert.ok(layoutSuits("menu-board", { hasPhotos: false, richCopy: true, copy: COPIES.rich! }));
  const decorated = (archetype: ArchetypeId) =>
    composeDesign({ format: "poster", copy: COPIES.event!, variant: { archetype, palette: "trust-blue", pairing: "editorial" }, photos: [], decor: { level: "bold", motifs: ["confetti", "sparkles", "dots"] } }).nodes.filter((n) => /confetti|sparkle|dot/i.test(n.name)).length;
  assert.ok(decorated("invitation") < decorated("ticket"), "invitation stays quiet whatever the brief asks");
});
await test("the server renderer draws every bundled family in its real typeface (no silent fallback)", () => {
  const fontFiles = readdirSync(fontDir()).filter((f) => f.endsWith(".ttf")).map((f) => join(fontDir(), f));
  for (const [key, family] of Object.entries(RENDER_FAMILIES)) {
    const role = { font: key as FontKey, weight: 400 as const, leading: 1.2 };
    const predicted = measure("Handgloves 2026", styleOf(role, 100));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="200"><text x="0" y="150" font-family="${family}" font-size="100" font-weight="400">Handgloves 2026</text></svg>`;
    const box = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Noto Sans" } }).getBBox();
    const rendered = (box?.x ?? 0) + (box?.width ?? 0);
    assert.ok(Math.abs(rendered - predicted) / predicted < 0.03, `${key} (${family}): measured ${Math.round(predicted)}, rendered ${Math.round(rendered)}`);
  }
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

// ── Photo effects ─────────────────────────────────────────────────────────────
console.log("photo effects");
const treatedDoc: FlyerDoc = {
  version: 1,
  format: "poster",
  width: 1240,
  height: 1754,
  background: "#111111",
  nodes: [
    { id: "bg", name: "Background photo", type: "image", src: "https://images.unsplash.com/photo-1?w=2000", x: 0, y: 0, width: 1240, height: 1754, rotation: 0, opacity: 1, cornerRadius: 0, effects: { tone: "duotone", dark: "#101820", light: "#F2C14E", blur: 18, dim: 0.4, grain: 0.3 } },
    { id: "win", name: "Focus window", type: "image", src: "https://images.unsplash.com/photo-1?w=2000", x: 520, y: 175, width: 380, height: 1150, rotation: 0, opacity: 1, cornerRadius: 0, fitFrame: { x: 0, y: 0, width: 1240, height: 1754 } },
    { id: "word", name: "Headline outline", type: "text", text: "REFRESH", x: 80, y: 1500, rotation: -90, opacity: 1, font: "display", fontSize: 300, fontWeight: 400, fill: "transparent", stroke: { color: "#111111", width: 4 }, align: "left", width: 1300, lineHeight: 0.9, letterSpacing: 0 },
    { id: "blk", name: "Accent block", type: "shape", shape: "rect", x: 600, y: 400, width: 300, height: 120, rotation: 0, opacity: 1, fill: "#D3281E", cornerRadius: 0, blend: "multiply" },
    { id: "tex", name: "Paper texture", type: "shape", shape: "rect", x: 0, y: 0, width: 1240, height: 1754, rotation: 0, opacity: 0.2, fill: "#808080", cornerRadius: 0, texture: "grain", blend: "multiply" },
    { id: "fade", name: "Fade", type: "shape", shape: "rect", x: 0, y: 0, width: 300, height: 1754, rotation: 0, opacity: 1, fill: "transparent", cornerRadius: 0, gradient: { from: "#FFFFFF", to: "rgba(255,255,255,0)", horizontal: true } },
  ],
};
await test("effects, windows, outline text, blend modes, grain and horizontal fades survive a save", () => {
  const parsed = flyerDocSchema.parse(JSON.parse(JSON.stringify(treatedDoc)));
  assert.deepEqual(parsed, treatedDoc, "nothing is stripped on save");
});
await test("the server renderer draws every effect (what the critic and the Illustrator file see)", () => {
  const images = new Map([["https://images.unsplash.com/photo-1?w=2000", { data: "data:image/png;base64,AAAA", width: 0, height: 0 }]]);
  const svg = docToSvg(treatedDoc, images);
  assert.match(svg, /<feGaussianBlur in="SourceGraphic" stdDeviation="18" result="r0"\/>/);
  assert.match(svg, /<feFuncR type="table" tableValues="0\.06 0\.95"\/>/, "duotone maps luminance between the two colours");
  assert.match(svg, /<feFuncR type="linear" slope="0\.6"\/>/, "dim");
  assert.match(svg, /feTurbulence[^>]*result="noise"/, "grain");
  assert.match(svg, /<image href="data:image\/png;base64,AAAA" x="-520" y="-175" width="1240" height="1754"/, "the window draws the full-page photo, offset, clipped to itself");
  assert.match(svg, /fill="none" fill="#111111"|fill="none" stroke="#111111" stroke-width="4"/, "outline text");
  assert.match(svg, /style="mix-blend-mode:multiply"/);
  assert.match(svg, /x1="0" y1="0" x2="1" y2="0"/, "horizontal gradient");
  assert.doesNotMatch(svg, /NaN|undefined/);
});
await test("a window crops the photo exactly where the full-page copy is", () => {
  const natural = { width: 2000, height: 3000 };
  const full = sourceCrop(natural, { x: 0, y: 0, width: 1240, height: 1754 });
  const win = sourceCrop(natural, { x: 520, y: 175, width: 380, height: 1150, fitFrame: { x: 0, y: 0, width: 1240, height: 1754 } });
  const scale = full.width / 1240;
  assert.ok(Math.abs(win.x - (full.x + 520 * scale)) < 0.01 && Math.abs(win.y - (full.y + 175 * scale)) < 0.01, "same source pixel under the same page point");
  assert.ok(Math.abs(win.width - 380 * scale) < 0.01);
});
await test("black and white and duotone use luminance; grain is seeded (identical every time)", () => {
  const px = () => new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
  const mono = px();
  treatPixels(mono, { tone: "mono" });
  assert.deepEqual([...mono.slice(0, 3)], [54, 54, 54], "red is dark in black and white");
  const duo = px();
  treatPixels(duo, { tone: "duotone", dark: "#000000", light: "#FF0000" });
  assert.deepEqual([...duo.slice(0, 3)], [54, 0, 0]);
  const a = px();
  const b = px();
  treatPixels(a, { grain: 0.5 });
  treatPixels(b, { grain: 0.5 });
  assert.deepEqual(a, b);
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
