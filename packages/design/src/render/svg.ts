import FAMILIES from "../../assets/fonts/families.json";
import RENDER_FAMILIES from "./font-families.json";
import { FORMATS } from "../canvas/formats";
import type { FlyerDoc, FlyerNode, ImageNode, PathNode, PhotoEffects, ShapeNode, TextNode } from "../canvas/types";
import { textLines } from "../geometry";
import METRICS from "../metrics.json";
import { postscriptName } from "./fonts";

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
  /** Designer file (Illustrator, Figma): named objects, fonts by PostScript name, no page clip. */
  designer: boolean;
  names: Map<string, number>;
}

/** A unique, XML-safe id from a layer name ("Headline", "Headline_2"); Illustrator names objects by id. */
function objectId(ctx: Ctx, name: string) {
  const base = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^([^A-Za-z_])/, "_$1") || "Layer";
  const count = (ctx.names.get(base) ?? 0) + 1;
  ctx.names.set(base, count);
  return count === 1 ? base : `${base}_${count}`;
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

function text(ctx: Ctx, node: TextNode) {
  const family = (FAMILIES as Record<string, string>)[node.font] ?? "Inter";
  // Illustrator matches fonts by PostScript name; browsers and Figma fall back to the family.
  // Designer files name fonts as a designer has them installed (PostScript name, then family); server
  // renders use the family each bundled file declares (some say "Montserrat Thin", not "Montserrat").
  const fontFamily = ctx.designer ? `'${postscriptName(node)}', '${family}'` : ((RENDER_FAMILIES as Record<string, string>)[node.font] ?? family);
  const lineHeight = node.fontSize * node.lineHeight;
  const anchor = node.align === "center" ? "middle" : node.align === "right" ? "end" : "start";
  const x = node.align === "center" ? node.width / 2 : node.align === "right" ? node.width : 0;
  const offset = baselineOffset(node);
  // Wrapped the way the editor wraps (engine text already carries its breaks; edited text may not).
  const lines = textLines(node).map(
    (line, i) => `<tspan x="${num(x)}" y="${num(i * lineHeight + lineHeight / 2 + offset)}">${esc(node.uppercase ? line.toUpperCase() : line)}</tspan>`,
  );
  return `<text font-family="${esc(fontFamily)}" font-size="${num(node.fontSize)}" font-weight="${node.fontWeight}"${node.italic ? ` font-style="italic"` : ""} text-anchor="${anchor}"${node.letterSpacing ? ` letter-spacing="${num(node.letterSpacing)}"` : ""} ${node.fill === "transparent" ? `fill="none"` : paintAttrs(node.fill, "fill")}${node.stroke ? ` ${paintAttrs(node.stroke.color, "stroke")} stroke-width="${num(node.stroke.width)}" stroke-linejoin="round"` : ""} xml:space="preserve">${lines.join("")}</text>`;
}

const rgbTable = (color: string | undefined, fallback: [number, number, number]) => {
  const hex = color?.match(/^#([0-9a-f]{6})$/i)?.[1];
  return hex ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) : fallback.map((v) => v / 255);
};

/** Blur → black and white or duotone → dim → grain, matching the editor's treatment (lib/canvas/effects.ts). */
function effectsFilter(ctx: Ctx, effects: PhotoEffects | undefined) {
  if (!effects || !(effects.blur || effects.tone || effects.dim || effects.grain)) return "";
  const id = nextId(ctx, "e");
  const steps: string[] = [];
  let last = "SourceGraphic";
  // Each primitive reads the previous result and names its own.
  const step = (markup: (input: string, result: string) => string) => {
    const result = `r${steps.length}`;
    steps.push(markup(last, result));
    last = result;
  };
  const transfer = (input: string, result: string, funcs: (c: string, i: number) => string) =>
    `<feComponentTransfer in="${input}" result="${result}">${["R", "G", "B"].map((c, i) => funcs(c, i)).join("")}</feComponentTransfer>`;
  if (effects.blur) step((input, result) => `<feGaussianBlur in="${input}" stdDeviation="${num(effects.blur!)}" result="${result}"/>`);
  if (effects.tone) {
    const l = "0.2126 0.7152 0.0722 0 0";
    step((input, result) => `<feColorMatrix in="${input}" type="matrix" values="${l} ${l} ${l} 0 0 0 1 0" result="${result}"/>`);
    if (effects.tone === "duotone") {
      const [d, h] = [rgbTable(effects.dark, [16, 16, 20]), rgbTable(effects.light, [240, 240, 236])];
      step((input, result) => transfer(input, result, (c, i) => `<feFunc${c} type="table" tableValues="${num(d[i]!)} ${num(h[i]!)}"/>`));
    }
  }
  if (effects.dim) step((input, result) => transfer(input, result, (c) => `<feFunc${c} type="linear" slope="${num(1 - effects.dim!)}"/>`));
  let grain = "";
  if (effects.grain) {
    const image = last;
    grain = `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise"/><feColorMatrix in="noise" type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 ${num(effects.grain * 0.55)}" result="grey"/><feBlend in="grey" in2="${image}" mode="overlay"/>`;
  }
  ctx.defs.push(`<filter id="${id}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">${steps.join("")}${grain}</filter>`);
  return ` filter="url(#${id})"`;
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
  // A window shows its part of the photo fitted to the larger frame (lib/canvas/types.ts fitFrame).
  const f = node.fitFrame ? { x: node.fitFrame.x - node.x, y: node.fitFrame.y - node.y, width: node.fitFrame.width, height: node.fitFrame.height } : { x: 0, y: 0, width, height };
  const filter = effectsFilter(ctx, node.effects);
  const picture = `<image href="${source.data}" x="${num(f.x)}" y="${num(f.y)}" width="${num(f.width)}" height="${num(f.height)}" preserveAspectRatio="xMidYMid slice"/>`;
  return `<g clip-path="url(#${clip})">${filter ? `<g${filter}>${picture}</g>` : picture}</g>${node.stroke ? `<rect width="${num(width)}" height="${num(height)}" rx="${num(rx)}" fill="none"${strokeAttrs(node.stroke)}/>` : ""}`;
}

function shape(ctx: Ctx, node: ShapeNode) {
  const { width, height } = node;
  let fill = paintAttrs(node.fill, "fill");
  if (node.gradient) {
    const id = nextId(ctx, "g");
    const [from, fromOpacity] = paint(node.gradient.from);
    const [to, toOpacity] = paint(node.gradient.to);
    ctx.defs.push(
      `<linearGradient id="${id}" x1="0" y1="0" x2="${node.gradient.horizontal ? 1 : 0}" y2="${node.gradient.horizontal ? 0 : 1}"><stop offset="0" stop-color="${from}" stop-opacity="${num(fromOpacity)}"/><stop offset="1" stop-color="${to}" stop-opacity="${num(toOpacity)}"/></linearGradient>`,
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
  if (node.texture === "grain") {
    const id = nextId(ctx, "t");
    ctx.defs.push(`<filter id="${id}" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>`);
    return `<rect width="${num(width)}" height="${num(height)}" fill="#808080" filter="url(#${id})"/>`;
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
  const body = node.type === "text" ? text(ctx, node) : node.type === "image" ? image(ctx, node) : node.type === "shape" ? shape(ctx, node) : path(node);
  const transform = `translate(${num(node.x)} ${num(node.y)})${node.rotation ? ` rotate(${num(node.rotation)})` : ""}`;
  const named = ctx.designer ? ` id="${objectId(ctx, node.name)}" data-name="${esc(node.name)}"` : "";
  const blend = node.blend ? ` style="mix-blend-mode:${node.blend}"` : "";
  return `<g${named} transform="${transform}"${node.opacity < 1 ? ` opacity="${num(node.opacity)}"` : ""}${blend}${shadowFilter(ctx, node)}>${body}</g>`;
}

/** The document as an SVG fragment (no <svg> wrapper), drawn in document units. */
export function docBody(doc: FlyerDoc, images: Ctx["images"], idPrefix = "", designer = false) {
  const ctx: Ctx = { defs: [], images, id: 0, designer, names: new Map() };
  // The page colour claims "Background" first, so a layer of the same name becomes "Background_2".
  const backgroundId = designer ? objectId(ctx, "Background") : "";
  const nodes = doc.nodes.map((node) => nodeSvg(ctx, node)).join("");
  const clip = `${idPrefix}page`;
  const defs = ctx.defs.map((d) => d.replace(/id="([a-z])(\d+)"/, `id="${idPrefix}$1$2"`)).join("");
  const body = nodes.replace(/url\(#([a-z])(\d+)\)/g, `url(#${idPrefix}$1$2)`);
  const background = `<rect${designer ? ` id="${backgroundId}" data-name="Background"` : ""} width="${doc.width}" height="${doc.height}" ${paintAttrs(doc.background, "fill")}/>`;
  // A designer file relies on the artboard for its edges; one big clipping group would make every object awkward to select.
  if (designer) return `<defs>${defs}</defs>${background}${body}`;
  return `<defs>${defs}<clipPath id="${clip}"><rect width="${doc.width}" height="${doc.height}"/></clipPath></defs><g clip-path="url(#${clip})">${background}${body}</g>`;
}

/**
 * The whole document as an SVG. `designer: true` makes the editable file for Illustrator
 * and Figma: named objects, fonts by PostScript name, and the physical page size for print
 * formats (A4 opens as an A4 artboard).
 */
export function docToSvg(doc: FlyerDoc, images: Ctx["images"] = new Map(), options: { designer?: boolean; title?: string } = {}) {
  const physical = options.designer ? FORMATS[doc.format].pdfPoints : undefined;
  const size = physical ? `width="${num(physical.width)}pt" height="${num(physical.height)}pt"` : `width="${doc.width}" height="${doc.height}"`;
  const title = options.title ? `<title>${esc(options.title)}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${doc.width} ${doc.height}">${title}${docBody(doc, images, "", options.designer)}</svg>`;
}
