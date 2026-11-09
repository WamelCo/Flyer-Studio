import type { FlyerNode } from "../canvas/types";
import { inkOn, path, rect, styleOf, text, textHeight, type Block, type Ctx, type DesignCopy } from "../engine";
import { measure } from "../metrics";

/** Rotate everything added since `fromIndex` around a pivot (a tilted headline block). */
export function rotateGroup(ctx: Ctx, fromIndex: number, pivot: { x: number; y: number }, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  for (const node of ctx.nodes.slice(fromIndex) as FlyerNode[]) {
    const dx = node.x - pivot.x;
    const dy = node.y - pivot.y;
    node.x = Math.round(pivot.x + dx * cos - dy * sin);
    node.y = Math.round(pivot.y + dx * sin + dy * cos);
    node.rotation += degrees;
  }
}

/** Short, label-like strings (chips, tags) — anything longer reads as a sentence. */
export function isShort(value: string | null | undefined, max = 16): value is string {
  return Boolean(value && value.length <= max);
}

export function joinDetails(ctx: Ctx) {
  return ctx.copy.details.map((d) => d.text).join("  ·  ");
}

export function bodyHeight(ctx: Ctx, value: string | null, size: number, width: number, maxLines: number) {
  return value ? textHeight(value, ctx.type.body, size, width, maxLines) : 0;
}

export function socialLine(ctx: Ctx) {
  return ctx.copy.contact.social.slice(0, 3).join("   ");
}

/** A straight-edged field in page coordinates (diagonal bands, cut corners). */
export function polygon(ctx: Ctx, points: [number, number][], fill: string, name = "Field") {
  const d = `${points.map(([x, y], i) => `${i ? "L" : "M"}${Math.round(x)} ${Math.round(y)}`).join("")}Z`;
  return path(ctx, [d], [ctx.W, ctx.H], { x: 0, y: 0, width: ctx.W, height: ctx.H }, { fill }, { name });
}

/**
 * A call-to-action pill. Filled (text in the readable ink for the fill) or outlined (stroke
 * and text both `color`). `x` is the left edge, centre or right edge per `align`.
 */
export function ctaPill(
  ctx: Ctx,
  label: string,
  options: { x: number; y: number; color: string; align?: "left" | "center" | "right"; outline?: boolean; size?: number; maxWidth?: number },
) {
  const size = options.size ?? ctx.scale.body;
  const role = ctx.type.label;
  const pad = size * 1.4;
  const textWidth = Math.min(measure(label, styleOf(role, size)), (options.maxWidth ?? Infinity) - pad * 2);
  const width = textWidth + pad * 2;
  const height = size * 2.5;
  const align = options.align ?? "left";
  const x = align === "center" ? options.x - width / 2 : align === "right" ? options.x - width : options.x;
  const ink = options.outline ? options.color : inkOn(ctx, options.color);
  if (options.outline) {
    rect(ctx, { x, y: options.y, width, height }, "transparent", { stroke: { color: options.color, width: Math.max(2, ctx.u * 0.25) }, cornerRadius: height / 2, name: "CTA" });
  } else {
    rect(ctx, { x, y: options.y, width, height }, options.color, { cornerRadius: height / 2, name: "CTA" });
  }
  text(ctx, label, { x: x + pad, y: options.y + (height - size * role.leading) / 2, width: textWidth, size, role, color: ink, maxLines: 1, align: "center", name: "CTA label" });
  return { width, height };
}

export const ctaHeight = (ctx: Ctx, size = ctx.scale.body) => size * 2.5;

/** Figures worth setting huge, best first: an offer, a price, an ordinal, a year, a time, a small count or age. */
const FIGURES = [/\b\d{1,3}\s?%/, /[$€£₦¥]\s?\d[\d,.]*k?\b/, /\b\d{1,3}(?:st|nd|rd|th)\b/i, /\b(?:19|20)\d{2}\b/, /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i, /\b\d{1,3}\b/];

/**
 * A figure worth setting huge — the offer, an age, a year — from the headline copy, never
 * invented. Phone numbers and long codes are not figures. The art director's emphasis wins.
 */
export function headlineFigure(copy: DesignCopy) {
  const clean = (value: string | null) => (value ?? "").replace(/\+?\d[\d\s().-]{6,}\d/g, " ");
  const emphasis = clean(copy.emphasis);
  const sources = [emphasis, clean(copy.headline), clean(copy.eyebrow), clean(copy.subhead)];
  for (const pattern of FIGURES) {
    const match = emphasis.match(pattern);
    if (match) return match[0].replace(/\s+/g, "").toUpperCase();
  }
  for (const pattern of FIGURES) {
    for (const source of sources) {
      const match = source.match(pattern);
      if (match) return match[0].replace(/\s+/g, "").toUpperCase();
    }
  }
  return null;
}

/** "Jollof rice — ₦2,500" → { name: "Jollof rice", price: "₦2,500" }. Prices only as written. */
export function splitPrice(value: string) {
  const match = value.match(/^(.*?)(?:\s*[—–\-:·|…]+\s*|\s+)((?:[$€£₦¥]|NGN|USD|GHS|KES|EUR|GBP)\s?\d[\d,.]*k?|\d[\d,.]*\s?(?:USD|EUR|GBP|NGN|GHS|KES|[$€£₦]))$/i);
  return match && match[1]!.trim() ? { name: match[1]!.trim(), price: match[2]!.trim() } : { name: value.trim(), price: null };
}

/** "9:00 Registration" / "10am – Keynote" → { time: "9:00", label: "Registration" }. */
export function splitTime(value: string) {
  const match = value.match(/^((?:\d{1,2}(?::\d{2})?\s?(?:am|pm)?|\d{1,2}h\d{0,2})(?:\s?[–-]\s?\d{1,2}(?::\d{2})?\s?(?:am|pm)?)?)\s*[—–\-:·|]?\s+(.+)$/i);
  return match ? { time: match[1]!.trim(), label: match[2]!.trim() } : { time: null, label: value.trim() };
}

/** Blocks for stack(): conditional entries (`C.body && {…}`) may be falsy. */
export type Blocks = (Block | null | false | undefined | "")[];
