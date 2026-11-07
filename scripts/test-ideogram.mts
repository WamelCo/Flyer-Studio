/**
 * Ideogram lead direction, tested against a local mock of Ideogram's API (no credits spent).
 *   pnpm test:ideogram
 * Covers: output sizes, the prompt (exact copy in quotes, requirements, no Magic Prompt),
 * matching detected text to approved copy, the editable-layer conversion, and the
 * pipeline's graceful fallback when Ideogram fails.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import type { TextNode } from "@/lib/canvas/types";
import { rulesBrief, toDesignCopy, type DesignBrief } from "@/lib/design/brief";
import { ideogramDirection, ideogramPrompt, ideogramSize } from "@/lib/design/ideogram";
import { approvedText, copyItems, ideogramDoc, type DetectedTextBlock } from "@/lib/design/ideogram-layers";
import { PALETTES } from "@/lib/design/palettes";
import { PAIRINGS } from "@/lib/design/typography";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const brief: DesignBrief = {
  ...rulesBrief("Summer jazz night at the Blue Room, Friday 8pm, tickets $15"),
  artwork: "A saxophonist silhouetted in a warm spotlight, cinematic photograph, headline in the dark sky above.",
  requirements: ["saxophone imagery", "gold and black colours"],
};
brief.copy = { ...brief.copy, headline: "Summer Jazz Night", eyebrow: "Live", subhead: "An evening of soul", cta: "Get tickets", details: [{ icon: "calendar", text: "Friday, 8pm" }, { icon: "ticket", text: "$15" }] };
const copy = toDesignCopy(brief);
const palette = PALETTES["luxe-gold"];
const pairing = PAIRINGS["poster-condensed"];

console.log("prompt & size");
await test("sizes: long side 2048, multiples of 32, within Ideogram's pixel cap", () => {
  for (const format of ["poster", "square", "story", "landscape"] as const) {
    const { width, height } = ideogramSize(format);
    assert.equal(Math.max(width, height), 2048, format);
    assert.equal(width % 32, 0);
    assert.equal(height % 32, 0);
    assert.ok(width * height <= 2048 * 2048);
  }
  assert.deepEqual(ideogramSize("poster"), { width: 1440, height: 2048 });
});
await test("prompt: every copy line in quotes, the artwork, the requirements, the palette", () => {
  const prompt = ideogramPrompt(brief, copy, "poster", palette, pairing);
  for (const item of copyItems(copy)) assert.ok(prompt.includes(`"${item.text}"`), item.text);
  assert.ok(prompt.includes(brief.artwork));
  assert.match(prompt, /saxophone imagery; gold and black colours/);
  assert.match(prompt, /no other words/);
  assert.ok(prompt.includes(palette.primary));
});

console.log("matching text to approved copy");
const items = copyItems(copy);
await test("exact, misspelled and re-cased blocks map to the approved copy", () => {
  assert.equal(approvedText("SUMMER JAZZ NIGHT", items)?.text, "Summer Jazz Night");
  assert.equal(approvedText("Sumer Jaz Nigth", items)?.text, "Summer Jazz Night");
  assert.equal(approvedText("GET TICKETS", items)?.text, "Get tickets");
  assert.equal(approvedText("FRIDAY, 8PM · $15", items)?.item.kind, "details");
});
await test("a headline split across blocks keeps each block's own words", () => {
  assert.equal(approvedText("SUMMER JAZZ", items)?.text, "Summer Jazz");
  assert.equal(approvedText("NIGHT", items)?.text, "Night");
});
await test("text Ideogram made up matches nothing", () => {
  assert.equal(approvedText("LOREM IPSUM DOLOR", items), null);
  assert.equal(approvedText("Free drinks all night", items), null);
});

console.log("editable layers");
const blocks: DetectedTextBlock[] = [
  { x: 144, y: 300, width: 1152, height: 420, text: "SUMER JAZZ\nNIGTH", alignment: "center", formatting: ["bold", "all_caps"], angle: 0, font_name: "Bebas Neue", font_size: 190, line_height: 1.05, color: "#F4E3B5", role: "heading" },
  { x: 520, y: 200, width: 400, height: 80, text: "Live", alignment: "center", formatting: ["italic"], angle: -6, font_name: "Great Vibes", font_size: 70, line_height: 1.1, color: "#FFFFFF", role: "subheading" },
  { x: 400, y: 1700, width: 640, height: 90, text: "GET TICKETS", alignment: "center", formatting: ["all_caps"], font_name: "Montserrat", font_size: 46, color: "#111111", role: "caption" },
  { x: 100, y: 1900, width: 600, height: 50, text: "www.fakeclub.com", alignment: "left", font_size: 30, color: "#FFFFFF", role: "caption" },
];
await test("artwork becomes a locked background; approved text becomes editable layers", () => {
  const { doc, kept, dropped } = ideogramDoc({ format: "poster", artworkUrl: "https://example.test/base.png", imageWidth: 1440, imageHeight: 2048, blocks, copy, palette, pairing });
  assert.equal(doc.width, 1240);
  const [art, ...texts] = doc.nodes;
  assert.equal(art?.type, "image");
  assert.equal(art?.locked, true);
  assert.equal(art?.width, 1240);
  assert.equal(kept, 3);
  assert.deepEqual(dropped, ["www.fakeclub.com"]);
  const byName = Object.fromEntries((texts as TextNode[]).map((t) => [t.name, t]));
  const headline = byName.Headline!;
  assert.equal(headline.text.replace(/\n/g, " "), "Summer Jazz Night", "re-typed with the approved spelling");
  assert.equal(headline.font, "display", "Bebas Neue maps to the display face");
  assert.equal(headline.uppercase, true);
  assert.equal(headline.fill, "#F4E3B5");
  assert.equal(headline.align, "center");
  assert.ok(Math.abs(headline.fontSize - Math.round(190 * (1754 / 2048))) <= 2, "font size scales with the page");
  assert.equal(byName.Eyebrow!.font, "calligraphy");
  assert.equal(byName.Eyebrow!.rotation, -6);
  assert.equal(byName["Call to action"]!.font, "geometric");
});

console.log("pipeline");
type Route = (req: IncomingMessage, body: string) => { status?: number; json?: unknown; bytes?: Buffer; type?: string };
let route: Route = () => ({ status: 404 });
const seen: { path: string; headers: IncomingMessage["headers"]; body: string }[] = [];
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  seen.push({ path: req.url ?? "", headers: req.headers, body });
  const out = route(req, body);
  res.writeHead(out.status ?? 200, { "content-type": out.type ?? (out.bytes ? "image/png" : "application/json") });
  res.end(out.bytes ?? JSON.stringify(out.json ?? { error: "mock" }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
Object.assign(process.env, { IDEOGRAM_BASE_URL: base, IDEOGRAM_API_KEY: "test-ideogram-key" });
const png = Buffer.from("89504e470d0a1a0a", "hex");
const input = { brief, copy, format: "poster" as const, palette, pairing, userId: "user-1", jobId: "job-1" };
const fakeStore = async () => "https://storage.example.test/flyers/user-1/ideogram/job-1.png";

const happy: Route = (req) => {
  if (req.url?.startsWith("/v2/image/generate/ideogram-4-5")) return { json: { generation_id: "g1", data: [{ url: `${base}/generated.png`, is_image_safe: true, resolution: "1440x2048", seed: 7 }] } };
  if (req.url === "/generated.png" || req.url === "/base.png") return { bytes: png };
  if (req.url?.startsWith("/v2/design/layerize/ideogram-3")) return { json: { data: [{ resolution: "1440x2048", base_image_url: `${base}/base.png`, url: `${base}/generated.png`, text_blocks: blocks }] } };
  return { status: 404 };
};

await test("generate → download → Layerize → store → editable doc", async () => {
  route = happy;
  seen.length = 0;
  const result = await ideogramDirection(input, { store: fakeStore });
  assert.ok(result);
  assert.equal(result.doc.nodes[0]?.type, "image");
  assert.equal((result.doc.nodes[0] as { src: string }).src, "https://storage.example.test/flyers/user-1/ideogram/job-1.png");
  const generate = seen.find((s) => s.path.startsWith("/v2/image/generate/"))!;
  assert.equal(generate.headers["api-key"], "test-ideogram-key");
  assert.match(generate.body, /name="magic_prompt"\r\n\r\noff/);
  assert.match(generate.body, /name="size"\r\n\r\n1440x2048/);
  assert.match(generate.body, /"Summer Jazz Night"/);
  const layerize = seen.find((s) => s.path.startsWith("/v2/design/layerize/"))!;
  assert.match(layerize.body, /name="image"; filename="flyer\.png"/);
});
await test("no credits (402), unsafe image or no recognisable text → null, so the engine designs it", async () => {
  const errors = console.error;
  console.error = () => undefined;
  route = () => ({ status: 402, json: { error: "insufficient_funds" } });
  assert.equal(await ideogramDirection(input, { store: fakeStore }), null);
  route = (req) => (req.url?.startsWith("/v2/image/generate/") ? { json: { data: [{ url: null, is_image_safe: false }] } } : happy(req, ""));
  assert.equal(await ideogramDirection(input, { store: fakeStore }), null);
  route = (req) => (req.url?.startsWith("/v2/design/layerize/") ? { json: { data: [{ base_image_url: `${base}/base.png`, text_blocks: [{ x: 0, y: 0, width: 10, height: 10, text: "LOREM" }] }] } } : happy(req, ""));
  assert.equal(await ideogramDirection(input, { store: fakeStore }), null);
  console.error = errors;
});
await test("without IDEOGRAM_API_KEY nothing is called", async () => {
  delete process.env.IDEOGRAM_API_KEY;
  seen.length = 0;
  assert.equal(await ideogramDirection(input, { store: fakeStore }), null);
  assert.equal(seen.length, 0);
});

server.close();
console.log(`\n${passed} passed`);
