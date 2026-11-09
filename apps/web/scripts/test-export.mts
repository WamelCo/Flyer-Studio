/**
 * Designer exports, offline: the Illustrator SVG (named objects, fonts by PostScript name,
 * physical page size, edited text wrapped) and the Photoshop PSD (written, then read back:
 * layer order, live text layers, fonts, resolution). The browser's Konva rasterising is
 * exercised in the app; here each layer gets synthetic pixels.
 *   pnpm test:export
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { initializeCanvas, readPsd, writePsd } from "ag-psd";

import type { FlyerDoc, TextNode } from "@flyer/design/canvas/types";
import { decorForVariant, rankedChoices, rulesBrief, toDesignCopy } from "@flyer/ai/brief";
import { chooseVariants, composeDesign, hasRichCopy } from "@flyer/design/compose";
import { psdDocument, type LayerPixels } from "@/lib/export/designer";
import { fontsUsed, postscriptName } from "@flyer/design/render/fonts";
import { EXPORT_FORMATS, exportWidth } from "@/lib/export/formats";
import { docToSvg } from "@flyer/design/render/svg";
import { isFormatAllowed } from "@flyer/billing/plans";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const brief = rulesBrief("Summer jazz night at the Blue Lotus, Friday 8pm");
const copy = toDesignCopy(brief);
const choices = rankedChoices(brief);
const variants = chooseVariants(choices, { hasPhotos: false, richCopy: hasRichCopy(copy) });
const doc = composeDesign({ format: "poster", copy, variant: variants[1]!, photos: [], decor: decorForVariant(choices.decor, 1) });
const texts = doc.nodes.filter((n): n is TextNode => n.type === "text");

console.log("fonts");
await test("PostScript names follow Google Fonts: nearest weight, italic when the family has one", () => {
  assert.equal(postscriptName({ font: "geometric", fontWeight: 600, italic: false }), "Montserrat-SemiBold");
  assert.equal(postscriptName({ font: "sans", fontWeight: 900, italic: false }), "Inter-ExtraBold", "nearest bundled weight");
  assert.equal(postscriptName({ font: "serif", fontWeight: 700, italic: true }), "PlayfairDisplay-BoldItalic");
  assert.equal(postscriptName({ font: "display", fontWeight: 700, italic: true }), "BebasNeue-Regular", "no italic face → upright");
});
await test("the export lists the families a design uses, with Google Fonts links", () => {
  const fonts = fontsUsed(doc);
  assert.ok(fonts.length >= 1);
  for (const font of fonts) assert.match(font.url, /^https:\/\/fonts\.google\.com\/specimen\/[A-Za-z+]+$/);
});

console.log("plans");
await test("Photoshop and Illustrator files are Pro and Max only", () => {
  for (const format of ["psd", "svg"] as const) {
    assert.ok(EXPORT_FORMATS[format].editable);
    assert.equal(isFormatAllowed("free", format), false);
    assert.ok(isFormatAllowed("pro", format) && isFormatAllowed("max", format));
  }
});

console.log("Illustrator (SVG)");
const svg = docToSvg(doc, new Map(), { designer: true, title: "Summer Jazz" });
await test("an A4 artboard, a title, and no page-wide clipping group", () => {
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="595.28pt" height="841.89pt" viewBox="0 0 1240 1754">/);
  assert.match(svg, /<title>Summer Jazz<\/title>/);
  assert.doesNotMatch(svg, /clip-path="url\(#page\)"/);
  assert.match(docToSvg(doc), /clip-path="url\(#page\)"/, "the critic's render keeps its page clip");
});
await test("every element is a named object; ids are unique and XML-safe", () => {
  const ids = [...svg.matchAll(/ id="([^"]+)" data-name="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(ids[0], "Background");
  assert.equal(ids.length, doc.nodes.filter((n) => !n.hidden && n.opacity > 0).length + 1);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Za-z_][A-Za-z0-9_-]*$/);
});
await test("text is live, set in its PostScript font with the family as fallback", () => {
  for (const node of texts) assert.ok(svg.includes(`font-family="'${postscriptName(node)}', '`), node.name);
  assert.doesNotMatch(svg, /NaN|undefined/);
});
await test("text edited in the editor (no line breaks) is wrapped as the editor shows it", () => {
  const long: TextNode = { ...texts[0]!, text: "A much longer line of words that the editor wraps inside its box", width: 400, uppercase: false };
  const out = docToSvg({ ...doc, nodes: [long] }, new Map(), { designer: true });
  assert.ok((out.match(/<tspan /g) ?? []).length >= 2);
});

console.log("Photoshop (PSD)");
// Reading back in Node: plain pixel arrays stand in for the browser's canvas.
initializeCanvas(
  () => {
    throw new Error("no canvas in tests");
  },
  (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData,
);
const width = exportWidth(doc, "psd");
const height = Math.round(doc.height * (width / doc.width));
const fill = (w: number, h: number, value: number): LayerPixels => ({ left: 0, top: 0, width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(value) });
const pixels = new Map(doc.nodes.map((n, i) => [n.id, { ...fill(40, 20, 200), left: 10 + i, top: 10 + i }] as const));
const psdBytes = writePsd(psdDocument(doc, width, pixels, fill(width, height, 255)), { generateThumbnail: false });
const psd = readPsd(new Uint8Array(psdBytes), { useImageData: true });

await test("a 2480 px canvas at the poster's real resolution (~212 dpi on A4)", () => {
  assert.equal(Math.max(psd.width, psd.height), 2480);
  assert.equal(psd.width, width);
  assert.equal(psd.imageResources?.resolutionInfo?.horizontalResolution, Math.round(width / (595.28 / 72)));
});
await test("layers bottom to top: the page colour, then every element in stacking order, by name", () => {
  const names = psd.children!.map((l) => l.name);
  assert.deepEqual(names, ["Background", ...doc.nodes.map((n) => n.name)]);
  assert.equal(psd.children![0]!.protected?.position, true, "the page colour is locked in place");
});
await test("text elements are live text layers: box text, PostScript font, size, colour, alignment", () => {
  const scale = width / doc.width;
  for (const node of texts) {
    const layer = psd.children!.find((l) => l.name === node.name && l.text?.text === node.text);
    assert.ok(layer?.text, node.name);
    assert.equal(layer.text.shapeType, "box");
    assert.equal(layer.text.style?.font?.name, postscriptName(node));
    assert.ok(Math.abs(layer.text.style!.fontSize! - node.fontSize * scale) < 0.01);
    assert.equal(layer.text.paragraphStyle?.justification ?? "left", node.align === "center" ? "center" : node.align === "right" ? "right" : "left");
    assert.ok(Math.abs(layer.text.transform![4]! - node.x * scale) < 0.01 && Math.abs(layer.text.transform![5]! - node.y * scale) < 0.01, "positioned at the element");
    if (node.uppercase) assert.equal(layer.text.style?.fontCaps, 2, "all caps keeps the typed text");
  }
});
await test("opacity and visibility are layer settings; layer pixels sit where they were drawn", () => {
  const fadedDoc: FlyerDoc = { ...doc, nodes: doc.nodes.map((n, i) => (i === 0 ? { ...n, opacity: 0.4, hidden: true } : n)) };
  const out = readPsd(new Uint8Array(writePsd(psdDocument(fadedDoc, width, pixels, fill(width, height, 255)), { generateThumbnail: false })), { useImageData: true });
  const layer = out.children![1]!;
  assert.ok(Math.abs(layer.opacity! - 0.4) < 0.01);
  assert.equal(layer.hidden, true);
  assert.equal(layer.left, 10);
  assert.equal(layer.top, 10);
});
await test("the file stays well under the 50 MB upload cap", () => {
  assert.ok(psdBytes.byteLength < 50 * 1024 * 1024, `${psdBytes.byteLength} bytes`);
});

// For a look in Photoshop or Photopea: scripts/.tmp/sample.psd and sample.svg (gitignored).
const out = join(import.meta.dirname, ".tmp");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "sample.psd"), new Uint8Array(psdBytes));
writeFileSync(join(out, "sample.svg"), svg);

console.log(`\n${passed} passed`);
