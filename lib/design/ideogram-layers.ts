import { nodeId } from "@/lib/canvas/ids";
import { FORMATS } from "@/lib/canvas/formats";
import type { FlyerDoc, FlyerFormat, FontKey, FontWeight, ImageNode } from "@/lib/canvas/types";
import { createCtx, inkOn, text, type DesignCopy } from "@/lib/design/engine";
import type { Palette } from "@/lib/design/palettes";
import type { Pairing, TypeRole } from "@/lib/design/typography";

/**
 * Turns an Ideogram design into an editable flyer: the text-free artwork Layerize
 * returns becomes a locked background, and every text block it detected becomes a real
 * text layer at the same position, size, angle and colour — re-typed with the approved
 * copy, so Ideogram's occasional misspellings and invented words never reach the page.
 */

/** A text block as Layerize returns it (positions in image pixels). */
export interface DetectedTextBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  alignment?: "left" | "center" | "right" | null;
  formatting?: string[] | null;
  angle?: number | null;
  font_name?: string | null;
  font_alternatives?: string[] | null;
  font_size?: number | null;
  line_height?: number | null;
  color?: string | null;
  role?: "heading" | "subheading" | "body" | "caption" | null;
}

/** One line of approved copy Ideogram was asked to set, and what it is. */
export interface CopyItem {
  kind: "headline" | "eyebrow" | "subhead" | "details" | "cta" | "brand" | "body" | "contact";
  text: string;
}

/** The approved copy, in the order the Ideogram prompt lists it. */
export function copyItems(copy: DesignCopy): CopyItem[] {
  const items: CopyItem[] = [{ kind: "headline", text: copy.headline }];
  if (copy.eyebrow) items.push({ kind: "eyebrow", text: copy.eyebrow });
  if (copy.subhead) items.push({ kind: "subhead", text: copy.subhead });
  if (copy.details.length) items.push({ kind: "details", text: copy.details.map((d) => d.text).join("  ·  ") });
  if (copy.cta) items.push({ kind: "cta", text: copy.cta });
  if (copy.brand) items.push({ kind: "brand", text: copy.brand });
  const contact = [copy.contact.phone, copy.contact.website, copy.contact.email].filter(Boolean).join("  ·  ");
  if (contact) items.push({ kind: "contact", text: contact });
  return items;
}

// ── Matching detected text to approved copy ──────────────────────────────────

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}%$€£]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

function similarity(a: string, b: string) {
  // Character bigram Dice coefficient: tolerant of OCR slips and Ideogram's misspellings.
  const grams = (s: string) => {
    const flat = words(s).join(" ");
    const out = new Map<string, number>();
    for (let i = 0; i < flat.length - 1; i++) out.set(flat.slice(i, i + 2), (out.get(flat.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ga) {
    overlap += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

/**
 * The approved text for a detected block: the whole item when the block is that item,
 * or the matching run of its words when Ideogram split an item across blocks
 * ("SUMMER JAZZ" / "NIGHT"). Null when the block matches nothing approved.
 */
export function approvedText(block: string, items: CopyItem[]): { item: CopyItem; text: string } | null {
  const target = words(block);
  if (!target.length) return null;
  let best: { item: CopyItem; text: string; score: number } | null = null;
  for (const item of items) {
    const whole = similarity(block, item.text);
    if (!best || whole > best.score) best = { item, text: item.text, score: whole };
    // A fragment: the best-matching run of the item's words with the block's word count.
    const source = item.text.split(/\s+/);
    const n = target.length;
    if (n < source.length) {
      for (let i = 0; i + n <= source.length; i++) {
        const run = source.slice(i, i + n).join(" ");
        const score = similarity(block, run);
        if (score > best.score) best = { item, text: run, score };
      }
    }
  }
  return best && best.score >= 0.62 ? { item: best.item, text: best.text } : null;
}

// ── Fonts ────────────────────────────────────────────────────────────────────

const FONT_NAMES: [RegExp, FontKey][] = [
  [/great vibes|vibes|allura|alex brush|parisienne|tangerine|calligraph/i, "calligraphy"],
  [/caveat|pacifico|lobster|brush|hand|marker|script|satisfy|kalam|dancing/i, "script"],
  [/bebas/i, "display"],
  [/anton|impact|league gothic|black ops|archivo black|heavy/i, "heavy"],
  [/oswald|condensed|compressed|narrow|barlow condensed|fjalla/i, "condensed"],
  [/dm serif|abril|didot|bodoni|ultra|display serif/i, "dserif"],
  [/cormorant|garamond|cinzel|baskerville|libre caslon|elegant/i, "elegant"],
  [/playfair|serif|times|georgia|merriweather|lora|crimson|frank ruhl/i, "serif"],
  [/space grotesk|grotesk|mono|ibm plex|jetbrains/i, "grotesk"],
  [/montserrat|poppins|futura|gotham|avenir|geometric|raleway|nunito|quicksand|sora|outfit/i, "geometric"],
  [/inter|helvetica|arial|roboto|open sans|lato|source sans|sf pro|neue/i, "sans"],
];

function fontFor(block: DetectedTextBlock, pairing: Pairing): TypeRole {
  const role = block.role === "heading" ? pairing.display : block.role === "subheading" ? pairing.heading : block.role === "caption" ? pairing.label : pairing.body;
  const names = [block.font_name, ...(block.font_alternatives ?? [])].filter((n): n is string => Boolean(n));
  for (const name of names) {
    const hit = FONT_NAMES.find(([pattern]) => pattern.test(name));
    if (hit) return { ...role, font: hit[1] };
  }
  return role;
}

// ── Conversion ───────────────────────────────────────────────────────────────

export interface IdeogramLayersInput {
  format: FlyerFormat;
  /** Text-free artwork, already stored in our bucket. */
  artworkUrl: string;
  /** Pixel size of the image Layerize analysed. */
  imageWidth: number;
  imageHeight: number;
  blocks: DetectedTextBlock[];
  copy: DesignCopy;
  palette: Palette;
  pairing: Pairing;
}

export function ideogramDoc(input: IdeogramLayersInput): { doc: FlyerDoc; kept: number; dropped: string[] } {
  const { format, copy, palette, pairing } = input;
  const { width: W, height: H } = FORMATS[format];
  const sx = W / input.imageWidth;
  const sy = H / input.imageHeight;
  const ctx = createCtx({ format, palette, type: pairing, copy, photos: [], motifs: [] });
  ctx.background = palette.dark;

  const artwork: ImageNode = {
    id: nodeId(),
    name: "Artwork",
    type: "image",
    src: input.artworkUrl,
    x: 0,
    y: 0,
    width: W,
    height: H,
    rotation: 0,
    opacity: 1,
    cornerRadius: 0,
    locked: true,
  };
  ctx.nodes.push(artwork);

  const items = copyItems(copy);
  const dropped: string[] = [];
  let kept = 0;
  // Largest first, so a headline split across blocks claims its words before smaller text does.
  const blocks = [...input.blocks].sort((a, b) => (b.font_size ?? b.height) - (a.font_size ?? a.height));
  for (const block of blocks) {
    const match = approvedText(block.text, items);
    if (!match) {
      dropped.push(block.text);
      continue;
    }
    const formatting = (block.formatting ?? []).map((f) => f.toLowerCase());
    const base = fontFor(block, pairing);
    const role: TypeRole = {
      ...base,
      weight: (formatting.includes("bold") ? Math.max(700, base.weight) : base.weight) as FontWeight,
      italic: formatting.includes("italic") || base.italic,
      uppercase: formatting.includes("all_caps") || (block.text === block.text.toUpperCase() && /\p{Lu}{2}/u.test(block.text)),
      tracking: formatting.includes("all_caps") ? Math.max(base.tracking ?? 0, 0.04) : (base.tracking ?? 0),
      leading: lineHeight(block),
    };
    const lines = block.text.split("\n").length;
    const size = Math.max(8, Math.round((block.font_size ?? block.height / lines / role.leading) * sy));
    const width = Math.max(size * 2, block.width * sx);
    // Ideogram rotates about the block's centre; Konva about its origin — keep the centre put.
    const angle = block.angle ?? 0;
    const cx = (block.x + block.width / 2) * sx;
    const cy = (block.y + block.height / 2) * sy;
    const t = (angle * Math.PI) / 180;
    const hw = width / 2;
    const hh = (block.height * sy) / 2;
    const x = angle ? cx - (hw * Math.cos(t) - hh * Math.sin(t)) : block.x * sx;
    const y = angle ? cy - (hw * Math.sin(t) + hh * Math.cos(t)) : block.y * sy;
    const longer = match.text.length > block.text.length * 1.3;
    const placed = text(ctx, match.text, {
      x,
      y,
      width,
      size,
      role,
      color: block.color && /^#[0-9a-f]{6}$/i.test(block.color) ? block.color : inkOn(ctx, palette.dark, true),
      align: block.alignment ?? "left",
      maxLines: lines + (longer ? 1 : 0),
      name: NAMES[match.item.kind],
    });
    if (angle) placed.node.rotation = Math.round(angle * 10) / 10;
    kept++;
  }
  return { doc: { version: 1, format, width: W, height: H, background: ctx.background, nodes: ctx.nodes }, kept, dropped };
}

const NAMES: Record<CopyItem["kind"], string> = {
  headline: "Headline",
  eyebrow: "Eyebrow",
  subhead: "Subhead",
  details: "Details",
  cta: "Call to action",
  brand: "Brand",
  body: "Body",
  contact: "Contact",
};

/** Layerize reports line height as a multiplier or in pixels; normalise to a multiplier. */
function lineHeight(block: DetectedTextBlock) {
  const value = block.line_height ?? 1.15;
  const ratio = value > 4 && block.font_size ? value / block.font_size : value;
  return Math.min(1.8, Math.max(0.85, ratio));
}
