import type { FontKey, FontWeight } from "../canvas/types";
import METRICS from "./metrics.json";

/**
 * Text measurement from real font metrics (scripts/gen-font-metrics.mjs), so the
 * layout engine can set type, wrap lines and fit headlines on the server exactly as
 * Konva will render them. Kerning is ignored (≈1–2% error), hence the small slack
 * layouts leave on text boxes.
 */

type FontTable = Record<string, number[] | number>;
const TABLE = METRICS as { chars: string; fonts: Record<FontKey, FontTable> };
const INDEX = new Map([...TABLE.chars].map((char, index) => [char, index]));

function weightsFor(font: FontKey) {
  return Object.keys(TABLE.fonts[font])
    .filter((key) => !key.includes(":"))
    .map(Number);
}

function nearestWeight(font: FontKey, weight: number) {
  return weightsFor(font).reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));
}

function widths(font: FontKey, weight: number) {
  return TABLE.fonts[font][String(nearestWeight(font, weight))] as number[];
}

const FALLBACK_CHAR = INDEX.get("n")!;

export interface TextStyle {
  font: FontKey;
  weight: FontWeight;
  size: number;
  uppercase?: boolean;
  /** Absolute letter-spacing in px. */
  letterSpacing?: number;
}

/** Advance width of a single line, matching Konva (letter-spacing after every glyph). */
export function measure(text: string, style: TextStyle) {
  const table = widths(style.font, style.weight);
  const value = style.uppercase ? text.toUpperCase() : text;
  let units = 0;
  for (const char of value) units += table[INDEX.get(char) ?? FALLBACK_CHAR]!;
  return (units / 1000) * style.size + (style.letterSpacing ?? 0) * [...value].length;
}

/** Cap height in px — used to optically align display type to grid lines. */
export function capHeight(style: Pick<TextStyle, "font" | "weight" | "size">) {
  const w = nearestWeight(style.font, style.weight);
  return ((TABLE.fonts[style.font][`${w}:cap`] as number) / 1000) * style.size;
}

/** Greedy word wrap; explicit newlines are kept. Long words are not broken. */
export function wrap(text: string, style: TextStyle, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || measure(candidate, style) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Height of a wrapped block. */
export function blockHeight(lineCount: number, size: number, leading: number) {
  return lineCount * size * leading;
}

/**
 * Largest size (stepping down from `max`) at which `text` wraps into at most `maxLines`
 * within `width`, and no single word overflows.
 */
export function fitSize(text: string, style: Omit<TextStyle, "size">, width: number, max: number, min: number, maxLines: number, trackingEm = 0) {
  for (let size = Math.round(max); size > min; size = Math.floor(size * 0.94)) {
    const sized = { ...style, size, letterSpacing: trackingEm * size };
    const lines = wrap(text, sized, width);
    const widest = Math.max(...lines.map((line) => measure(line, sized)));
    if (lines.length <= maxLines && widest <= width) return size;
  }
  return Math.round(min);
}
