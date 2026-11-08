import type { FlyerDoc, FlyerNode, ImageNode, ShapeNode, TextNode } from "../canvas/types";
import { measure } from "./metrics";

/*
 * Revision targeting. A rendered flyer was drawn from an engine design, so we know where
 * every element sits. An instruction like "change the price to US$20" names elements;
 * masking exactly those boxes means the precise edit can only touch them — everything
 * else is copied pixel for pixel. Instructions that name no element get no mask.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RevisionTarget {
  /** What was matched, for logs and UI ("price", "headline", "Look your best"). */
  label: string;
  /** In design (page) coordinates, padded. */
  box: Box;
}

const PRICE = /(?:US\$|[$€£]|\bZiG\s?)\s?\d/i;
const HERO_HOSTS = new Set(["Disc", "Colour circle", "Colour card"]);
const PHONE = /\d{3,4}[\s.-]?\d{3}[\s.-]?\d{3,4}/;

function textBox(node: TextNode): Box {
  const lines = node.text.split("\n");
  const style = { font: node.font, weight: node.fontWeight, size: node.fontSize, uppercase: node.uppercase, letterSpacing: node.letterSpacing };
  const widest = Math.min(node.width, Math.max(...lines.map((line) => measure(line, style))));
  const x = node.align === "center" ? node.x + (node.width - widest) / 2 : node.align === "right" ? node.x + node.width - widest : node.x;
  return { x, y: node.y, width: widest, height: lines.length * node.fontSize * node.lineHeight };
}

function boxOf(node: FlyerNode): Box {
  const box = node.type === "text" ? textBox(node) : { x: node.x, y: node.y, width: node.width, height: node.height };
  if (!node.rotation) return box;
  // Tilted elements: use a generous square around the box so the mask covers the rotation.
  const side = Math.hypot(box.width, box.height);
  return { x: box.x + box.width / 2 - side / 2, y: box.y + box.height / 2 - side / 2, width: side, height: side };
}

function pad(box: Box, amount: number, doc: FlyerDoc): Box {
  const x = Math.max(0, box.x - amount);
  const y = Math.max(0, box.y - amount);
  return { x, y, width: Math.min(doc.width, box.x + box.width + amount) - x, height: Math.min(doc.height, box.y + box.height + amount) - y };
}

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - 4 && inner.y >= outer.y - 4 && inner.x + inner.width <= outer.x + outer.width + 4 && inner.y + inner.height <= outer.y + outer.height + 4;

/** Words in quotes ("Look your best", 'Book today') are names of text on the flyer. */
function quoted(instruction: string) {
  return [...instruction.matchAll(/["“'‘]([^"”'’]{2,80})["”'’]/g)].map((m) => m[1]!.trim().toLowerCase());
}

/**
 * The design elements an instruction is about. Global requests ("warmer colours",
 * "more festive") return nothing: the whole image may change.
 */
export function revisionTargets(doc: FlyerDoc, instruction: string): RevisionTarget[] {
  const ask = instruction.toLowerCase();
  const nodes = doc.nodes.filter((n) => !n.hidden && n.opacity > 0.04);
  const texts = nodes.filter((n): n is TextNode => n.type === "text");
  const images = nodes.filter((n): n is ImageNode => n.type === "image" && !(n.width >= doc.width - 2 && n.height >= doc.height - 2));
  const padding = Math.min(doc.width, doc.height) * 0.025;
  const found = new Map<FlyerNode, string>();
  const add = (node: FlyerNode, label: string) => {
    if (!found.has(node)) found.set(node, label);
  };

  // Global changes: no mask.
  if (/\b(background|whole|entire|overall|all colou?rs|everything|more (?:festive|modern|vibrant))\b/.test(ask)) return [];

  for (const phrase of quoted(instruction)) {
    for (const node of texts) if (node.text.replace(/\n/g, " ").toLowerCase().includes(phrase)) add(node, phrase);
  }
  if (/\b(price|cost|amount|us\$|zig)\b/.test(ask)) for (const node of texts) if (PRICE.test(node.text)) add(node, "price");
  // "the phone in the photo" is the hero, not the number; "the WhatsApp button" is the button.
  if (/\b(phone (?:number|no)|(?:the|our|my) number|contact (?:number|details)|whats ?app (?:number|line)|call(?:ing)? number|cell(?:phone)? number)\b/.test(ask))
    for (const node of texts) if (PHONE.test(node.text)) add(node, "phone number");
  if (/\b(headline|title|heading)\b/.test(ask)) for (const node of texts) if (node.name.startsWith("Headline")) add(node, "headline");
  if (/\b(subhead|subtitle|tagline)\b/.test(ask)) for (const node of texts) if (node.name === "Subhead" || node.name === "Eyebrow") add(node, "subheadline");
  if (/\b(button|call to action|cta)\b/.test(ask)) {
    for (const node of nodes) {
      if (node.type === "shape" && node.name === "CTA") {
        add(node, "button");
        for (const text of texts) if (contains(boxOf(node), boxOf(text))) add(text, "button");
      }
    }
  }
  if (/\b(brand|business name|company name|logo)\b/.test(ask)) for (const node of texts) if (node.name === "Brand") add(node, "brand name");
  if (/\b(photo|picture|image|woman|man|person|people|lady|girl|boy|model|phone|product|hair|braids|face|cut-?out)\b/.test(ask) && !/\bphone (?:number|no)\b/.test(ask)) {
    // The hero: the largest photo frame — or, in a layout without frames, the disc or
    // colour card the renderer stands the cut-out hero on.
    const hosts = nodes.filter((n): n is ShapeNode => n.type === "shape" && HERO_HOSTS.has(n.name));
    const pool: (ImageNode | ShapeNode)[] = images.length ? images : hosts;
    if (pool.length) add(pool.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)), "hero image");
  }

  return [...found].map(([node, label]) => ({ label, box: pad(boxOf(node), padding, doc) }));
}

/**
 * Design boxes → pixel boxes in a rendered image. Renders are cover-fitted to a preset
 * size (render-prompt.ts), so the same centred cover mapping applies.
 */
export function toImageBoxes(doc: FlyerDoc, boxes: Box[], width: number, height: number): Box[] {
  const s = Math.max(width / doc.width, height / doc.height);
  const offX = (width - doc.width * s) / 2;
  const offY = (height - doc.height * s) / 2;
  return boxes.map((b) => ({ x: b.x * s + offX, y: b.y * s + offY, width: b.width * s, height: b.height * s }));
}
