/**
 * Offline checks for the render-prompt compiler (render-prompt.ts) — no API calls.
 *   pnpm test:render
 *
 * Every rule here came from a real Ideogram failure during prompt development:
 * dropped elements past the prompt budget, invented filler in empty space, collages over
 * photo backdrops, prompt prose rendered as text, panels drawn around empty regions.
 */
import assert from "node:assert/strict";

import { FORMAT_ORDER } from "../src/canvas/formats";
import type { FlyerFormat, TextNode } from "../src/canvas/types";
import { ARCHETYPE_IDS } from "../src/design/archetypes";
import { composeDesign } from "../src/design/compose";
import type { StockPhoto } from "../src/design/engine";
import { PALETTES } from "../src/design/palettes";
import { PRINCIPLE_IDS, PRINCIPLES } from "../src/design/principles";
import { colorName, compileRenderPrompt, type IdeogramPrompt } from "../src/design/render-prompt";
import { PAIRINGS } from "../src/design/typography";
import { rankedChoices, rulesBrief, toDesignCopy } from "../src/design/brief";
import { inferHero } from "../src/design/imagery";
import { followReference, referenceStyleFrom } from "../src/design/reference";
import { revisionTargets } from "../src/design/revision";
import { FIXTURES } from "./render-fixtures.mts";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const stock: StockPhoto[] = Array.from({ length: 4 }, (_, i) => ({ url: `render://photo/${i}`, width: 1600, height: 1200, credit: { name: "", url: "" } }));
const HEX = /^#[0-9A-F]{6}$/;

function compile(name: string, format?: FlyerFormat, archetype?: (typeof ARCHETYPE_IDS)[number]) {
  const fixture = FIXTURES[name]!;
  const variant = { ...fixture.variant, ...(archetype && { archetype }) };
  const doc = composeDesign({ format: format ?? fixture.format, copy: fixture.copy, variant, photos: stock, decor: fixture.decor });
  const prompt = compileRenderPrompt(doc, {
    archetype: variant.archetype,
    palette: PALETTES[variant.palette],
    pairing: PAIRINGS[variant.pairing],
    subject: fixture.subject,
    tone: fixture.tone,
    photoPrompts: fixture.photos,
  });
  return { doc, prompt };
}

function elements(prompt: IdeogramPrompt) {
  return prompt.compositional_deconstruction.elements;
}

console.log("render prompt");

// Every fixture × every format × every layout: 100 compositions.
const all = Object.keys(FIXTURES).flatMap((name) =>
  FORMAT_ORDER.flatMap((format) => ARCHETYPE_IDS.map((archetype) => ({ name, format, archetype, ...compile(name, format, archetype) }))),
);

test(`stays inside Ideogram's 10,000-character prompt across ${all.length} compositions`, () => {
  for (const { name, format, archetype, prompt } of all) {
    const size = JSON.stringify(prompt).length;
    assert.ok(size <= 9_600, `${name}/${format}/${archetype}: ${size} chars`);
  }
});

test("every visible word on the page is sent verbatim as a text element", () => {
  for (const { name, format, archetype, doc, prompt } of all) {
    const sent = new Set(elements(prompt).filter((e) => e.type === "text").map((e) => e.text));
    for (const node of doc.nodes.filter((n): n is TextNode => n.type === "text" && !n.hidden)) {
      const expected = node.uppercase ? node.text.toUpperCase() : node.text;
      assert.ok(sent.has(expected), `${name}/${format}/${archetype}: missing ${JSON.stringify(expected)}`);
    }
  }
});

test("bounding boxes are valid [y_min, x_min, y_max, x_max] on the 0–1000 grid", () => {
  for (const { name, prompt } of all) {
    for (const element of elements(prompt)) {
      if (!element.bbox) continue;
      const [y0, x0, y1, x1] = element.bbox;
      for (const v of element.bbox) assert.ok(Number.isInteger(v) && v >= 0 && v <= 1000, `${name}: ${element.bbox}`);
      assert.ok(y0 <= y1 && x0 <= x1, `${name}: inverted bbox ${element.bbox}`);
    }
  }
});

test("colours travel as hex palettes; prose names colours (no hex for the model to print)", () => {
  for (const { name, prompt } of all) {
    assert.ok(prompt.style_description.color_palette.length <= 16);
    for (const color of prompt.style_description.color_palette) assert.match(color, HEX);
    for (const element of elements(prompt)) {
      assert.ok(!/#[0-9a-f]{6}/i.test(element.desc), `${name}: hex in desc: ${element.desc}`);
      for (const color of element.color_palette ?? []) assert.match(color, HEX);
      assert.ok((element.color_palette ?? []).length <= 5);
    }
  }
});

test("the style block stays short (long style prose gets rendered as text)", () => {
  for (const { name, prompt } of all) {
    assert.ok(prompt.style_description.art_style.length < 1_100, `${name}: ${prompt.style_description.art_style.length}`);
    for (const element of elements(prompt)) assert.ok(element.desc.length < 420, `${name}: long desc ${element.desc.length}`);
  }
});

test("a photo backdrop is the first, full-frame element and forbids collages", () => {
  const { prompt } = compile("thanksgiving");
  const first = elements(prompt)[0]!;
  assert.deepEqual(first.bbox, [0, 0, 1000, 1000]);
  assert.match(first.desc, /single continuous/);
  assert.match(prompt.style_description.art_style, /no collage/);
  assert.doesNotMatch(prompt.compositional_deconstruction.background, /negative space/, "no empty zones over a photo");
});

test("empty regions are named in the background prose, never boxed as panels", () => {
  const { prompt } = compile("tech");
  assert.match(prompt.compositional_deconstruction.background, /deliberate negative space: .+ stay completely empty/);
  assert.ok(!elements(prompt).some((e) => /negative space/.test(e.desc)));
  assert.match(prompt.compositional_deconstruction.background, /no other text, words, sections/);
});

test("headline lines and the emphasised word keep their roles; the summary quotes the full headline", () => {
  const { prompt } = compile("health");
  assert.match(prompt.high_level_description, /headlined "Dream job in healthcare"|headlined "DREAM JOB IN HEALTHCARE"|headlined "[^"]*Dream[^"]*healthcare"/i);
  const dream = elements(prompt).find((e) => e.text === "DREAM")!;
  assert.match(dream.desc, /emphasised headline word/);
  assert.match(dream.desc, /tilts together/);
});

test("generic text nodes get roles from their content and position", () => {
  const { prompt } = compile("consulting");
  const byText = (value: string) => elements(prompt).find((e) => e.text === value)!.desc;
  assert.match(byText("555-123-4567"), /phone number/);
  assert.match(byText("hello@northwind.co"), /email address/);
  assert.match(byText("Call us now"), /label directly above the phone number/);
  assert.match(byText("Call us now"), /top left of the page/);
});

test("structure is never dropped for budget: bullets, chips and icons all survive", () => {
  const { prompt } = compile("consulting");
  assert.equal(elements(prompt).filter((e) => /bullet/i.test(e.desc)).length, 3);
  assert.ok(elements(prompt).some((e) => /icon: bar chart/.test(e.desc)));
});

test("colour names: near-black reads as near-black, rgba scrims parse", () => {
  assert.equal(colorName("#FFFFFF"), "white");
  assert.equal(colorName("#1A1A1D"), "near-black");
  assert.equal(colorName("rgba(30,20,14,0.45)"), "translucent near-black brown (45%)");
  assert.equal(colorName("#D6202A"), "red");
});

test("every principle has a rule, an enforcement, a directive and a short cue", () => {
  for (const id of PRINCIPLE_IDS) {
    const p = PRINCIPLES[id];
    assert.ok(p.rule && p.enforced && p.directive && p.cue, id);
    assert.ok(p.cue.length <= 90, `${id} cue too long`);
  }
});

// ── Hero imagery, requested style, references, revisions ───────────────────────

const PHONES =
  "FixIt Mobile, cracked screen repairs in 1 hour, iPhone and Samsung screens from US$25, Harare CBD, WhatsApp 0719 553 802, black and gold colours";

test("the hero is inferred from the business: a cracked screen is a phone with a shattered screen", () => {
  const hero = inferHero(PHONES)!;
  assert.equal(hero.kind, "item");
  assert.match(hero.subject, /cracked|shattered/);
});

test("requested colours win, in either order, and never reach the copy; brand casing is kept", () => {
  const brief = rulesBrief(PHONES);
  assert.equal(brief.brandColor, "#111111");
  assert.equal(brief.accentColor, "#C9A227");
  assert.equal(rulesBrief("Fresh green maize seedlings, call 0772 111 222").brandColor, null);
  const copy = toDesignCopy(brief);
  assert.equal(copy.headline.replace(/\n/g, " "), "FixIt Mobile");
  assert.ok(copy.details.some((d) => d.text === "iPhone and Samsung screens"));
  assert.ok(!JSON.stringify(copy).toLowerCase().includes("gold"));
});

test("a colon list becomes bullets", () => {
  const brief = rulesBrief("Greenway Accountants, tax returns and bookkeeping in Harare: VAT returns, payroll, annual financial statements, call 0242 700 123");
  const copy = toDesignCopy(brief);
  assert.deepEqual(copy.bullets.slice(0, 3), ["VAT returns", "Payroll", "Annual financial statements"]);
  assert.equal(copy.subhead, "Tax returns and bookkeeping in Harare");
});

test("a light reference keeps a light page and its structure; Swiss goes last", () => {
  const style = referenceStyleFrom(
    { high_level_description: "A business flyer with a man, arms crossed, on a clean white background inside a circular graphic behind him." },
    [
      { hex: "#F7F7F7", share: 0.8 },
      { hex: "#385BA9", share: 0.06 },
    ],
  );
  assert.equal(style.tone, "light");
  assert.equal(style.brandColor, "#385BA9");
  const ranked = followReference({ layouts: ["swiss-type", "bold-stack"], palettes: ["tech-violet", "trust-blue"] } as Parameters<typeof followReference>[0], style);
  assert.equal(ranked.layouts[0], "editorial-split");
  assert.equal(ranked.layouts.at(-1), "swiss-type");
  for (const id of ranked.palettes) assert.ok(colorName(PALETTES[id].bg).includes("white") || PALETTES[id].bg > "#E0", id);
});

test("revisions target only the elements named", () => {
  const brief = rulesBrief(PHONES);
  const ranked = rankedChoices(brief);
  const variant = { archetype: "swiss-type" as const, palette: ranked.palettes[0]!, pairing: ranked.pairings[0]! };
  const doc = composeDesign({ format: "poster", copy: toDesignCopy(brief), variant, photos: [] });
  const labels = (ask: string) => [...new Set(revisionTargets(doc, ask).map((t) => t.label))];
  assert.deepEqual(labels("Change the price to US$20"), ["price"]);
  assert.deepEqual(labels("Make the WhatsApp us button green"), ["button"]);
  assert.deepEqual(labels("Replace the phones in the image with a Samsung"), ["hero image"]);
  assert.deepEqual(labels("Change the phone number to 0772 000 000"), ["phone number"]);
  assert.deepEqual(labels("Make the background warmer"), []);
});

console.log(`\n${passed} passed`);
