import type { FlyerDoc, FlyerNode, ImageNode, PathNode, ShapeNode, TextNode } from "@/lib/canvas/types";
import FAMILIES from "@/assets/fonts/families.json";
import METRICS from "@/lib/design/metrics.json";

/**
 * FlyerDoc → SVG, geometry-identical to the Konva editor (components/canvas/flyer-nodes.tsx):
 * nodes rotate about their own x/y, text lines sit where Konva's middle baseline puts
 * them, photos are cover-cropped. Text is already wrapped by the engine ("\n"), so no
 * re-wrapping happens here. Images must be supplied as data URIs (see png.ts).
 */

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (value: number) => (Math.round(value * 100) / 100).toString();

/** rgba()/hex → [colour, opacity] for SVG fill + fill-opacity. */
function paint(color: string): [string, number] {
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1]!.split(",").map((s) => s.trim());
    return [`rgb(${r},${g},${b})`, Number(a)];
  }
  if (color === "transparent") return ["none", 1];
  return [color, 1];
}

const paintAttrs = (color: string, kind: "fill" | "stroke") => {
  const [value, opacity] = paint(color);
  return `${kind}="${value}"${opacity < 1 ? ` ${kind}-opacity="${num(opacity)}"` : ""}`;
};

/** Konva draws each line with textBaseline "middle": the baseline sits (ascent − descent)/2 below the line's centre. */
function baselineOffset(node: TextNode) {
  const table = (METRICS.fonts as unknown as Record<string, Record<string, number | number[]>>)[node.font] ?? {};
  const weights = Object.keys(table).filter((k) => /^\d+$/.test(k)).map(Number);
  const nearest = weights.sort((a, b) => Math.abs(a - node.fontWeight) - Math.abs(b - node.fontWeight))[0] ?? 400;
  const asc = Number(table[`${nearest}:asc`] ?? 900);
  const desc = Number(table[`${nearest}:desc`] ?? 250);
  return ((asc - desc) / 2 / 1000) * node.fontSize;
}

interface Ctx {
  defs: string[];
  images: Map<string, { data: string; width: number; height: number }>;
  id: number;
}

const nextId = (ctx: Ctx, prefix: string) => `${prefix}${++ctx.id}`;

function shadowFilter(ctx: Ctx, node: FlyerNode) {
  if (!node.shadow) return "";
  const id = nextId(ctx, "s");
  const [color, opacity] = paint(node.shadow.color);
  ctx.defs.push(
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${num(node.shadow.offsetX)}" dy="${num(node.shadow.offsetY)}" stdDeviation="${num(node.shadow.blur / 2)}" flood-color="${color}" flood-opacity="${num(opacity)}"/></filter>`,
  );
  return ` filter="url(#${id})"`;
}

function strokeAttrs(stroke: ShapeNode["stroke"] | ImageNode["stroke"]) {
  if (!stroke) return "";
  return ` ${paintAttrs(stroke.color, "stroke")} stroke-width="${num(stroke.width)}"${stroke.dash?.length ? ` stroke-dasharray="${stroke.dash.join(" ")}"` : ""}`;
}

function text(node: TextNode) {
  const family = (FAMILIES as Record<string, string>)[node.font] ?? "Inter";
  const content = node.uppercase ? node.text.toUpperCase() : node.text;
  const lineHeight = node.fontSize * node.lineHeight;
  const anchor = node.align === "center" ? "middle" : node.align === "right" ? "end" : "start";
  const x = node.align === "center" ? node.width / 2 : node.align === "right" ? node.width : 0;
  const offset = baselineOffset(node);
  const lines = content.split("\n").map(
    (line, i) => `<tspan x="${num(x)}" y="${num(i * lineHeight + lineHeight / 2 + offset)}">${esc(line)}</tspan>`,
  );
  return `<text font-family="${esc(family)}" font-size="${num(node.fontSize)}" font-weight="${node.fontWeight}"${node.italic ? ` font-style="italic"` : ""} text-anchor="${anchor}"${node.letterSpacing ? ` letter-spacing="${num(node.letterSpacing)}"` : ""} ${paintAttrs(node.fill, "fill")} xml:space="preserve">${lines.join("")}</text>`;
}

function image(ctx: Ctx, node: ImageNode) {
  const { width, height, cornerRadius } = node;
  const rx = Math.min(cornerRadius, width / 2, height / 2);
  const source = node.src ? ctx.images.get(node.src) : undefined;
  if (!source) {
    // Empty frame (or an image that couldn't load): the editor's dashed placeholder.
    return `<rect width="${num(width)}" height="${num(height)}" rx="${num(rx)}" fill="rgb(128,128,128)" fill-opacity="0.18"${node.stroke ? strokeAttrs(node.stroke) : ` stroke="rgb(128,128,128)" stroke-opacity="0.45" stroke-width="2" stroke-dasharray="10 8"`}/>`;
  }
  const clip = nextId(ctx, "c");
  ctx.defs.push(`<clipPath id="${clip}"><rect width="${num(width)}" height="${num(height)}" rx="${num(rx)}"/></clipPath>`);
  return `<g clip-path="url(#${clip})"><image href="${source.data}" width="${num(width)}" height="${num(height)}" preserveAspectRatio="xMidYMid slice"/></g>${node.stroke ? `<rect width="${num(width)}" height="${num(height)}" rx="${num(rx)}" fill="none"${strokeAttrs(node.stroke)}/>` : ""}`;
}

function shape(ctx: Ctx, node: ShapeNode) {
  const { width, height } = node;
  let fill = paintAttrs(node.fill, "fill");
  if (node.gradient) {
    const id = nextId(ctx, "g");
    const [from, fromOpacity] = paint(node.gradient.from);
    const [to, toOpacity] = paint(node.gradient.to);
    ctx.defs.push(
      `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}" stop-opacity="${num(fromOpacity)}"/><stop offset="1" stop-color="${to}" stop-opacity="${num(toOpacity)}"/></linearGradient>`,
    );
    fill = `fill="url(#${id})"`;
  }
  const stroke = strokeAttrs(node.stroke);
  if (node.shape === "ellipse") {
    return `<ellipse cx="${num(width / 2)}" cy="${num(height / 2)}" rx="${num(width / 2)}" ry="${num(height / 2)}" ${fill}${stroke}/>`;
  }
  if (node.shape === "arc" && node.arc) {
    const r = Math.min(width, height) / 2;
    const inner = Math.max(0, r - node.arc.thickness);
    const cx = width / 2;
    const cy = height / 2;
    const sweep = Math.min(359.999, node.arc.sweep);
    const a0 = ((node.arc.start - 90) * Math.PI) / 180;
    const a1 = a0 + (sweep * Math.PI) / 180;
    const pt = (radius: number, a: number) => `${num(cx + radius * Math.cos(a))} ${num(cy + radius * Math.sin(a))}`;
    const large = sweep > 180 ? 1 : 0;
    const d = `M${pt(r, a0)}A${num(r)} ${num(r)} 0 ${large} 1 ${pt(r, a1)}L${pt(inner, a1)}A${num(inner)} ${num(inner)} 0 ${large} 0 ${pt(inner, a0)}Z`;
    return `<path d="${d}" ${fill}${stroke}/>`;
  }
  return `<rect width="${num(width)}" height="${num(height)}"${node.cornerRadius ? ` rx="${num(Math.min(node.cornerRadius, width / 2, height / 2))}"` : ""} ${fill}${stroke}/>`;
}

function path(node: PathNode) {
  const [vw, vh] = node.viewBox;
  const fill = node.fill ? paintAttrs(node.fill, "fill") : `fill="none"`;
  const stroke = node.stroke ? ` ${paintAttrs(node.stroke.color, "stroke")} stroke-width="${num(node.stroke.width)}" stroke-linecap="round" stroke-linejoin="round"` : "";
  return `<g transform="scale(${num(node.width / vw)} ${num(node.height / vh)})">${node.paths.map((d) => `<path d="${esc(d)}" ${fill}${stroke}/>`).join("")}</g>`;
}

function nodeSvg(ctx: Ctx, node: FlyerNode) {
  if (node.hidden || node.opacity <= 0) return "";
  const body = node.type === "text" ? text(node) : node.type === "image" ? image(ctx, node) : node.type === "shape" ? shape(ctx, node) : path(node);
  const transform = `translate(${num(node.x)} ${num(node.y)})${node.rotation ? ` rotate(${num(node.rotation)})` : ""}`;
  return `<g transform="${transform}"${node.opacity < 1 ? ` opacity="${num(node.opacity)}"` : ""}${shadowFilter(ctx, node)}>${body}</g>`;
}

/** The document as an SVG fragment (no <svg> wrapper), drawn in document units. */
export function docBody(doc: FlyerDoc, images: Ctx["images"], idPrefix = "") {
  const ctx: Ctx = { defs: [], images, id: 0 };
  const nodes = doc.nodes.map((node) => nodeSvg(ctx, node)).join("");
  const clip = `${idPrefix}page`;
  const defs = ctx.defs.map((d) => d.replace(/id="([a-z])(\d+)"/, `id="${idPrefix}$1$2"`)).join("");
  const body = nodes.replace(/url\(#([a-z])(\d+)\)/g, `url(#${idPrefix}$1$2)`);
  return `<defs>${defs}<clipPath id="${clip}"><rect width="${doc.width}" height="${doc.height}"/></clipPath></defs><g clip-path="url(#${clip})"><rect width="${doc.width}" height="${doc.height}" ${paintAttrs(doc.background, "fill")}/>${body}</g>`;
}

export function docToSvg(doc: FlyerDoc, images: Ctx["images"] = new Map()) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${docBody(doc, images)}</svg>`;
}
