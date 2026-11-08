import { FORMATS } from "../canvas/formats";
import { nodeId } from "../canvas/ids";
import type { FlyerFormat, FlyerNode, ImageNode, PathNode, ShapeNode, Stroke, TextNode } from "../canvas/types";
import { contrast, CONTRAST, mix, readableOn } from "./color";
import ICONS from "./icons.json";
import { measure, wrap, type TextStyle } from "./metrics";
import type { Palette } from "./palettes";
import { typeScale, type Pairing, type TypeRole } from "./typography";

/**
 * Layout engine primitives. Archetypes describe a design in terms of these — grid,
 * type roles, frames, motifs — and the engine turns them into editable canvas nodes
 * with measured, non-overflowing type.
 */

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface StockPhoto {
  url: string;
  width: number;
  height: number;
  credit: { name: string; url: string };
}

export interface DesignCopy {
  brand: string | null;
  eyebrow: string | null;
  headline: string;
  emphasis: string | null;
  subhead: string | null;
  bodyTitle: string | null;
  body: string | null;
  bullets: string[];
  features: { title: string; text: string; icon: IconName }[];
  details: { icon: IconName; text: string }[];
  cta: string | null;
  contact: { phone: string | null; email: string | null; website: string | null; address: string | null; social: string[] };
}

export type Orientation = "portrait" | "square" | "landscape" | "tall";

export interface Ctx {
  format: FlyerFormat;
  W: number;
  H: number;
  orientation: Orientation;
  /** Outer margin — generous, as print designers leave. */
  m: number;
  /** Base spacing unit (8-point style rhythm, scaled to the page). */
  u: number;
  scale: ReturnType<typeof typeScale>;
  palette: Palette;
  type: Pairing;
  copy: DesignCopy;
  photos: StockPhoto[];
  motifs: Set<string>;
  nodes: FlyerNode[];
  background: string;
}

export function createCtx(input: {
  format: FlyerFormat;
  palette: Palette;
  type: Pairing;
  copy: DesignCopy;
  photos: StockPhoto[];
  motifs: string[];
}): Ctx {
  const { width: W, height: H } = FORMATS[input.format];
  const ratio = W / H;
  const orientation: Orientation = ratio > 1.15 ? "landscape" : ratio < 0.6 ? "tall" : ratio < 0.9 ? "portrait" : "square";
  const short = Math.min(W, H);
  return {
    ...input,
    W,
    H,
    orientation,
    m: Math.round(short * 0.075),
    u: Math.round(short * 0.01),
    scale: typeScale(W, H),
    motifs: new Set(input.motifs),
    nodes: [],
    background: input.palette.bg,
  };
}

function base(name: string, x: number, y: number) {
  return { id: nodeId(), name, x: Math.round(x), y: Math.round(y), rotation: 0, opacity: 1 };
}

export function add<T extends FlyerNode>(ctx: Ctx, node: T): T {
  ctx.nodes.push(node);
  return node;
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export function rect(
  ctx: Ctx,
  frame: { x: number; y: number; width: number; height: number },
  fill: string,
  options: Partial<Pick<ShapeNode, "cornerRadius" | "gradient" | "stroke" | "opacity" | "rotation" | "shadow" | "locked">> & { name?: string } = {},
) {
  return add<ShapeNode>(ctx, {
    ...base(options.name ?? "Rectangle", frame.x, frame.y),
    type: "shape",
    shape: "rect",
    width: Math.max(1, Math.round(frame.width)),
    height: Math.max(1, Math.round(frame.height)),
    fill,
    cornerRadius: Math.round(options.cornerRadius ?? 0),
    ...(options.gradient && { gradient: options.gradient }),
    ...(options.stroke && { stroke: options.stroke }),
    ...(options.shadow && { shadow: options.shadow }),
    opacity: options.opacity ?? 1,
    rotation: options.rotation ?? 0,
    ...(options.locked && { locked: true }),
  });
}

export function circle(ctx: Ctx, cx: number, cy: number, radius: number, fill: string, options: { stroke?: Stroke; opacity?: number; name?: string } = {}) {
  return add<ShapeNode>(ctx, {
    ...base(options.name ?? "Circle", cx - radius, cy - radius),
    type: "shape",
    shape: "ellipse",
    width: Math.round(radius * 2),
    height: Math.round(radius * 2),
    fill,
    cornerRadius: 0,
    ...(options.stroke && { stroke: options.stroke }),
    opacity: options.opacity ?? 1,
  });
}

/** A ring segment around (cx, cy). Angles in degrees from 12 o'clock, clockwise. */
export function ring(ctx: Ctx, cx: number, cy: number, radius: number, thickness: number, color: string, start = 0, sweep = 360, opacity = 1) {
  return add<ShapeNode>(ctx, {
    ...base("Ring", cx - radius, cy - radius),
    type: "shape",
    shape: "arc",
    width: Math.round(radius * 2),
    height: Math.round(radius * 2),
    fill: color,
    cornerRadius: 0,
    arc: { start, sweep, thickness: Math.round(thickness) },
    opacity,
  });
}

export function path(
  ctx: Ctx,
  paths: string[],
  viewBox: [number, number],
  frame: { x: number; y: number; width: number; height: number },
  paint: { fill?: string | null; stroke?: { color: string; width: number } | null },
  options: { name?: string; rotation?: number; opacity?: number; icon?: string } = {},
) {
  return add<PathNode>(ctx, {
    ...base(options.name ?? "Shape", frame.x, frame.y),
    type: "path",
    paths,
    viewBox,
    width: Math.round(frame.width),
    height: Math.round(frame.height),
    fill: paint.fill ?? null,
    stroke: paint.stroke ?? null,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    ...(options.icon && { icon: options.icon }),
  });
}

export function icon(ctx: Ctx, name: IconName, x: number, y: number, size: number, color: string, weight = 2) {
  return path(ctx, ICONS[name], [24, 24], { x, y, width: size, height: size }, { stroke: { color, width: weight } }, { name: `${name} icon`, icon: name });
}

/** An icon centred on a filled chip (rounded square or circle). */
export function iconChip(ctx: Ctx, name: IconName, x: number, y: number, size: number, fill: string, color: string, round = false) {
  rect(ctx, { x, y, width: size, height: size }, fill, { cornerRadius: round ? size / 2 : size * 0.26, name: "Icon chip" });
  const inner = size * 0.52;
  icon(ctx, name, x + (size - inner) / 2, y + (size - inner) / 2, inner, color, 2.2);
}

export function dotGrid(ctx: Ctx, x: number, y: number, cols: number, rows: number, gap: number, radius: number, color: string, opacity = 0.7) {
  const paths: string[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = col * gap + radius;
      const cy = row * gap + radius;
      paths.push(`M${cx - radius} ${cy}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0`);
    }
  }
  const width = (cols - 1) * gap + radius * 2;
  const height = (rows - 1) * gap + radius * 2;
  return path(ctx, [paths.join("")], [width, height], { x, y, width, height }, { fill: color }, { name: "Dot grid", opacity });
}

export function crossMark(ctx: Ctx, cx: number, cy: number, size: number, color: string) {
  return path(ctx, ["M4 4L20 20M20 4L4 20"], [24, 24], { x: cx - size / 2, y: cy - size / 2, width: size, height: size }, { stroke: { color, width: 3.5 } }, { name: "Cross" });
}

/** An L-shaped corner bracket; `corner` picks which corner it frames. */
export function bracket(ctx: Ctx, x: number, y: number, size: number, thickness: number, color: string, corner: "tl" | "tr" | "bl" | "br") {
  const t = (thickness / size) * 100;
  const d = {
    tl: `M0 0H100V${t}H${t}V100H0Z`,
    tr: `M0 0H100V100H${100 - t}V${t}H0Z`,
    bl: `M0 0H${t}V${100 - t}H100V100H0Z`,
    br: `M${100 - t} 0H100V100H0V${100 - t}H${100 - t}Z`,
  }[corner];
  return path(ctx, [d], [100, 100], { x, y, width: size, height: size }, { fill: color }, { name: "Bracket" });
}

export function starburst(ctx: Ctx, cx: number, cy: number, radius: number, color: string, points = 16, depth = 0.82) {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const r = i % 2 === 0 ? 50 : 50 * depth;
    d += `${i === 0 ? "M" : "L"}${(50 + r * Math.cos(angle)).toFixed(2)} ${(50 + r * Math.sin(angle)).toFixed(2)}`;
  }
  return path(ctx, [`${d}Z`], [100, 100], { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 }, { fill: color }, { name: "Starburst" });
}

/** Five stars, for ratings. */
export function stars(ctx: Ctx, x: number, y: number, size: number, color: string) {
  const one = ICONS.star;
  for (let i = 0; i < 5; i++) path(ctx, one, [24, 24], { x: x + i * size * 1.1, y, width: size, height: size }, { fill: color, stroke: { color, width: 1 } }, { name: "Star", icon: "star" });
  return size * 1.1 * 5;
}

// ── Photos ───────────────────────────────────────────────────────────────────

export function photo(
  ctx: Ctx,
  index: number,
  frame: { x: number; y: number; width: number; height: number },
  options: { cornerRadius?: number; stroke?: Stroke; rotation?: number; shadow?: boolean; name?: string } = {},
) {
  const source = ctx.photos[index];
  return add<ImageNode>(ctx, {
    ...base(options.name ?? (source ? "Photo" : "Photo slot"), frame.x, frame.y),
    type: "image",
    src: source?.url ?? "",
    width: Math.round(frame.width),
    height: Math.round(frame.height),
    cornerRadius: Math.round(options.cornerRadius ?? 0),
    rotation: options.rotation ?? 0,
    ...(options.stroke && { stroke: options.stroke }),
    ...(options.shadow && { shadow: { color: "rgba(0,0,0,0.28)", blur: Math.round(ctx.u * 3), offsetX: 0, offsetY: Math.round(ctx.u * 1.2) } }),
    ...(source && { credit: source.credit }),
  });
}

export function hasPhoto(ctx: Ctx, index: number) {
  return Boolean(ctx.photos[index]);
}

// ── Type ─────────────────────────────────────────────────────────────────────

export function styleOf(role: TypeRole, size: number): TextStyle {
  return { font: role.font, weight: role.weight, size, uppercase: role.uppercase, letterSpacing: (role.tracking ?? 0) * size };
}

interface TextOptions {
  x: number;
  y: number;
  width: number;
  size: number;
  role: TypeRole;
  color: string;
  align?: TextNode["align"];
  maxLines?: number;
  name?: string;
  /** Override the role's leading. */
  leading?: number;
}

/**
 * Sets a text block: wraps it with real metrics and returns the laid-out height so
 * callers can stack the next element. Copy that overflows maxLines first shrinks (to
 * 72%, never taller than planned) — a designer resizes before cutting words — and only
 * then is truncated with an ellipsis.
 */
export function text(ctx: Ctx, value: string, options: TextOptions) {
  const { role } = options;
  let size = options.size;
  // 1px tolerance: a box sized from measure() must hold the same text.
  let lines = wrap(value, styleOf(role, size), options.width + 1);
  if (options.maxLines && lines.length > options.maxLines) {
    // Whole pixels, so the rendered node wraps exactly as measured here.
    for (let next = Math.floor(size * 0.96); next >= Math.ceil(options.size * 0.72); next = Math.floor(next * 0.96)) {
      const attempt = wrap(value, styleOf(role, next), options.width + 1);
      size = next;
      lines = attempt;
      if (attempt.length <= options.maxLines) break;
    }
  }
  const style = styleOf(role, size);
  if (options.maxLines && lines.length > options.maxLines) {
    lines = lines.slice(0, options.maxLines);
    lines[lines.length - 1] = `${lines.at(-1)!.replace(/[\s,.;:]+\S*$/, "")}…`;
  }
  const leading = options.leading ?? role.leading;
  // Slack absorbs kerning differences so Konva never re-wraps a line we measured.
  const slack = Math.ceil(size * 0.25);
  const align = options.align ?? "left";
  const node = add<TextNode>(ctx, {
    ...base(options.name ?? "Text", options.x - (align === "center" ? slack / 2 : align === "right" ? slack : 0), options.y),
    type: "text",
    text: lines.join("\n"),
    font: role.font,
    fontSize: Math.round(size),
    fontWeight: role.weight,
    ...(role.italic && { italic: true }),
    ...(role.uppercase && { uppercase: true }),
    fill: options.color,
    align,
    width: Math.round(options.width + slack),
    lineHeight: leading,
    letterSpacing: Math.round(style.letterSpacing! * 10) / 10,
  });
  const widest = Math.max(...lines.map((line) => measure(line, style)));
  return { node, height: lines.length * size * leading, lines: lines.length, width: widest };
}

/** Text height without placing it (for stacking decisions). */
export function textHeight(value: string, role: TypeRole, size: number, width: number, maxLines?: number, leading?: number) {
  const lines = Math.min(maxLines ?? Infinity, wrap(value, styleOf(role, size), width).length);
  return lines * size * (leading ?? role.leading);
}

// ── Headlines with emphasis ──────────────────────────────────────────────────

interface Word {
  text: string;
  emphasis: boolean;
}

function splitEmphasis(headline: string, emphasis: string | null): Word[] {
  const words = headline.split(/\s+/).filter(Boolean);
  if (!emphasis) return words.map((text) => ({ text, emphasis: false }));
  const target = emphasis.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
  const clean = target.map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""));
  let start = -1;
  for (let i = 0; i + clean.length <= lower.length; i++) {
    if (clean.every((w, k) => lower[i + k] === w)) {
      start = i;
      break;
    }
  }
  return words.map((text, i) => ({ text, emphasis: start >= 0 && i >= start && i < start + clean.length }));
}

interface HeadlineLayout {
  size: number;
  lines: Word[][];
  widths: number[];
}

function layoutHeadline(words: Word[], ctx: Ctx, size: number, width: number, emphasisSize: number) {
  const plain = styleOf(ctx.type.display, size);
  const strong = styleOf(ctx.type.emphasis, emphasisSize);
  const space = (w: Word) => measure(" ", w.emphasis ? strong : plain);
  const wordWidth = (w: Word) => measure(w.text, w.emphasis ? strong : plain);

  const lines: Word[][] = [];
  const widths: number[] = [];
  let line: Word[] = [];
  let lineWidth = 0;
  for (const word of words) {
    const w = wordWidth(word);
    const next = line.length ? lineWidth + space(word) + w : w;
    if (line.length && next > width) {
      lines.push(line);
      widths.push(lineWidth);
      line = [word];
      lineWidth = w;
    } else {
      line.push(word);
      lineWidth = next;
    }
  }
  if (line.length) {
    lines.push(line);
    widths.push(lineWidth);
  }
  const fits = words.every((w) => wordWidth(w) <= width);
  return { lines, widths, fits };
}

/**
 * Fits a headline into a box: largest size where it wraps into ≤ maxLines without
 * overflow and without leaving a lone short word (widow) on the last line.
 */
export function fitHeadline(
  ctx: Ctx,
  headline: string,
  emphasis: string | null,
  width: number,
  maxSize: number,
  minSize: number,
  maxLines: number,
  emphasisScale = 1,
  maxHeight = Infinity,
): HeadlineLayout {
  const words = splitEmphasis(headline, emphasis);
  let fallback: HeadlineLayout | null = null;
  const leading = ctx.type.display.leading;
  for (let size = Math.round(maxSize); size >= minSize; size = Math.floor(size * 0.95)) {
    const { lines, widths, fits } = layoutHeadline(words, ctx, size, width, size * emphasisScale);
    if (!fits || lines.length > maxLines) continue;
    if (lines.length * size * leading * (emphasisScale > 1 ? 1.15 : 1) > maxHeight) continue;
    const layout = { size, lines, widths };
    const last = lines.at(-1)!;
    const widow = lines.length > 1 && last.length === 1 && widths.at(-1)! < width * 0.3;
    if (!widow) return layout;
    fallback ??= layout;
  }
  if (fallback) return fallback;
  const size = Math.round(minSize);
  const { lines, widths } = layoutHeadline(words, ctx, size, width, size * emphasisScale);
  return { size, lines: lines.slice(0, maxLines), widths: widths.slice(0, maxLines) };
}

/**
 * Places a fitted headline. Plain consecutive lines become one text node; lines with
 * emphasis are split into runs so the emphasised words can change weight or colour.
 */
export function placeHeadline(
  ctx: Ctx,
  layout: HeadlineLayout,
  options: {
    x: number;
    y: number;
    width: number;
    align: TextNode["align"];
    color: string;
    /** The preferred emphasis colour; swapped for another palette colour if it wouldn't read on `background`. */
    emphasisColor: string;
    /** What the headline sits on, for the emphasis contrast check (several for a gradient: it must read on all). */
    background: string | string[];
    emphasisScale?: number;
    leading?: number;
  },
) {
  const { size } = layout;
  const emphasisSize = Math.round(size * (options.emphasisScale ?? 1));
  const { palette: P, scale } = ctx;
  const display = emphasisSize >= scale.body * 2 || (emphasisSize >= scale.body * 1.5 && ctx.type.emphasis.weight >= 700);
  const backgrounds = ([] as string[]).concat(options.background);
  const minimum = display ? CONTRAST.large : CONTRAST.body;
  const candidates = [options.emphasisColor, P.primary, P.accent, P.accent2, options.color];
  const emphasisColor =
    candidates.find((color) => backgrounds.every((bg) => contrast(color, bg) >= minimum)) ?? readableOn(backgrounds[0]!, candidates, minimum);
  const leading = options.leading ?? ctx.type.display.leading;
  const plain = styleOf(ctx.type.display, size);
  const strong = styleOf(ctx.type.emphasis, emphasisSize);
  let y = options.y;
  let buffer: string[] = [];
  let bufferY = y;

  const flush = () => {
    if (!buffer.length) return;
    text(ctx, buffer.join("\n"), { x: options.x, y: bufferY, width: options.width, size, role: ctx.type.display, color: options.color, align: options.align, name: "Headline", leading });
    buffer = [];
  };

  layout.lines.forEach((words, index) => {
    const lineHeight = Math.max(...words.map((w) => (w.emphasis ? emphasisSize : size))) * leading;
    if (!words.some((w) => w.emphasis)) {
      if (!buffer.length) bufferY = y;
      buffer.push(words.map((w) => w.text).join(" "));
      y += size * leading;
      return;
    }
    flush();
    const total = layout.widths[index]!;
    let cursor = options.align === "center" ? options.x + (options.width - total) / 2 : options.align === "right" ? options.x + options.width - total : options.x;
    // Group consecutive words that share a style into one run.
    const runs: Word[][] = [];
    for (const word of words) {
      const last = runs.at(-1);
      if (last && last[0]!.emphasis === word.emphasis) last.push(word);
      else runs.push([word]);
    }
    for (const run of runs) {
      const strongRun = run[0]!.emphasis;
      const style = strongRun ? strong : plain;
      const value = run.map((w) => w.text).join(" ");
      const runSize = strongRun ? emphasisSize : size;
      // Baseline-align runs of different sizes on the same line.
      const dy = (lineHeight - runSize * leading) * 0.85;
      text(ctx, value, {
        x: cursor,
        y: y + dy,
        width: measure(value, style) + 2,
        size: runSize,
        role: strongRun ? ctx.type.emphasis : ctx.type.display,
        color: strongRun ? emphasisColor : options.color,
        name: strongRun ? "Headline emphasis" : "Headline",
        leading,
      });
      cursor += measure(`${value} `, style);
    }
    y += lineHeight;
  });
  flush();
  return y - options.y;
}

// ── Vertical rhythm ──────────────────────────────────────────────────────────

export interface Block {
  /** Higher survives longer when space runs out. */
  priority: number;
  gapBefore: number;
  height: (width: number) => number;
  render: (x: number, y: number, width: number) => void;
}

/**
 * Stacks blocks top-down inside a region. If they don't fit, the lowest-priority blocks
 * are dropped (never overlapped) — the way a designer cuts copy rather than cramming.
 */
export function stack(
  region: { x: number; y: number; width: number; height: number },
  blocks: (Block | null | false | undefined)[],
  valign: "top" | "bottom" | "center" | "justify" = "top",
) {
  let kept = blocks.filter((b): b is Block => Boolean(b));
  const total = (list: Block[]) => list.reduce((sum, b, i) => sum + (i ? b.gapBefore : 0) + b.height(region.width), 0);
  while (kept.length > 1 && total(kept) > region.height) {
    const lowest = kept.reduce((min, b) => (b.priority < min.priority ? b : min));
    kept = kept.filter((b) => b !== lowest);
  }
  const height = total(kept);
  // justify: spare space opens up the gaps (at most 2.5×), the rest centres the stack.
  const gaps = kept.slice(1).reduce((sum, b) => sum + b.gapBefore, 0);
  const stretch = valign === "justify" && gaps > 0 ? Math.min(2.5, 1 + Math.max(0, region.height - height) / gaps) : 1;
  const used = height + gaps * (stretch - 1);
  let y =
    valign === "bottom" ? region.y + region.height - used : valign === "center" || valign === "justify" ? region.y + (region.height - used) / 2 : region.y;
  kept.forEach((block, i) => {
    if (i) y += block.gapBefore * stretch;
    block.render(region.x, y, region.width);
    y += block.height(region.width);
  });
  return { height: used, bottom: y, top: y - used };
}

// ── Colour helpers bound to the palette ─────────────────────────────────────

/** Text colour guaranteed readable on `background`. */
export function inkOn(ctx: Ctx, background: string, large = false) {
  const { palette } = ctx;
  return readableOn(background, [palette.ink, palette.onDark, palette.onPrimary, "#FFFFFF", "#111111"], large ? CONTRAST.large : CONTRAST.body);
}

export function mutedOn(ctx: Ctx, background: string) {
  const { palette } = ctx;
  return contrast(palette.muted, background) >= CONTRAST.body ? palette.muted : softOn(inkOn(ctx, background), background, 0.78);
}

/**
 * `ink` softened towards `background` (as if at `opacity`) only as far as contrast
 * allows: secondary copy reads quieter but never drops below `minimum`. Returned as a
 * solid colour, so it prints exactly as checked.
 */
export function softOn(ink: string, background: string, opacity: number, minimum: number = CONTRAST.body) {
  for (let a = opacity; a < 1; a += 0.02) {
    const color = mix(background, ink, a);
    if (contrast(color, background) >= minimum) return color;
  }
  return ink;
}

/** An accent that reads on `background` (falls back to ink). */
export function accentOn(ctx: Ctx, background: string, large = true) {
  const { palette } = ctx;
  return readableOn(background, [palette.primary, palette.accent, palette.accent2, inkOn(ctx, background)], large ? CONTRAST.large : CONTRAST.body);
}

export function contactLines(copy: DesignCopy) {
  const { contact } = copy;
  return [
    contact.phone && { icon: "phone" as IconName, text: contact.phone },
    contact.email && { icon: "mail" as IconName, text: contact.email },
    contact.website && { icon: "globe" as IconName, text: contact.website },
    contact.address && { icon: "map-pin" as IconName, text: contact.address },
  ].filter((line): line is { icon: IconName; text: string } => Boolean(line));
}

/** Icon + text rows (details, contact). Returns the block height. */
export function iconRows(ctx: Ctx, rows: { icon: IconName; text: string }[], x: number, y: number, width: number, size: number, color: string, iconColor: string, role: TypeRole = ctx.type.body) {
  let cursor = y;
  const iconSize = Math.round(size * 1.15);
  const gap = Math.round(size * 0.7);
  for (const row of rows) {
    icon(ctx, row.icon, x, cursor + (size * role.leading - iconSize) / 2, iconSize, iconColor);
    const placed = text(ctx, row.text, { x: x + iconSize + gap, y: cursor, width: width - iconSize - gap, size, role, color, maxLines: 2 });
    cursor += placed.height + size * 0.55;
  }
  return cursor - y;
}

export function iconRowsHeight(ctx: Ctx, rows: { text: string }[], width: number, size: number, role: TypeRole = ctx.type.body) {
  const iconSize = Math.round(size * 1.15);
  const gap = Math.round(size * 0.7);
  return rows.reduce((sum, row) => sum + textHeight(row.text, role, size, width - iconSize - gap, 2) + size * 0.55, 0);
}
