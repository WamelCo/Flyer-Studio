import { FORMATS } from "../canvas/formats";
import type { FlyerDoc, FlyerFormat, FlyerNode, FontKey, ImageNode, PathNode, ShapeNode, TextNode } from "../canvas/types";
import { ARCHETYPES, type ArchetypeId } from "./archetypes";
import { hexToRgb, isHex } from "./color";
import { measure } from "./metrics";
import type { Palette } from "./palettes";
import { PRINCIPLE_IDS, principleCues } from "./principles";
import { typeScale, type Pairing } from "./typography";

/*
 * Compiles a composed FlyerDoc into an Ideogram 4.x structured JSON prompt.
 *
 * The layout engine is the designer: it has already placed every element on the grid,
 * measured every line of type, spaced blocks on the base unit and checked contrast.
 * This compiler hands that finished layout to the image model as a precise brief —
 * each text block, shape, icon and photo frame becomes an element with an exact
 * bounding box (0–1000, [y_min, x_min, y_max, x_max]), its exact words and colours — so
 * the model renders the design instead of inventing one.
 *
 * Format: https://docs.ideogram.ai/prompting/json-prompting
 */

export interface IdeogramElement {
  type: "obj" | "text";
  bbox?: [number, number, number, number];
  text?: string;
  desc: string;
  color_palette?: string[];
}

export interface IdeogramPrompt {
  high_level_description: string;
  style_description: {
    aesthetics: string;
    lighting: string;
    medium: string;
    art_style: string;
    color_palette: string[];
  };
  compositional_deconstruction: {
    background: string;
    elements: IdeogramElement[];
  };
}

export interface RenderMeta {
  archetype: ArchetypeId;
  palette: Palette;
  pairing: Pairing;
  /** What the flyer is for, e.g. "healthcare training recruitment". */
  subject: string;
  tone?: string[];
  /** Descriptions for photo frames, in node order (from the brief's photo queries). */
  photoPrompts?: string[];
  /**
   * How large empty regions are declared: in the background prose by position (default),
   * or as bounding-box elements (stronger, but the model tends to outline them as panels).
   */
  negativeSpace?: "prose" | "boxes";
  /** Where the flyer will be used ("Zimbabwe"): photos show local places and people. */
  region?: string;
}

/** Ideogram 4.5 only accepts its preset sizes; each format renders at the nearest one. */
export const RENDER_SIZES: Record<FlyerFormat, { width: number; height: number }> = {
  poster: { width: 1664, height: 2496 },
  square: { width: 2048, height: 2048 },
  story: { width: 1440, height: 2560 },
  landscape: { width: 2560, height: 1440 },
};

/** Ideogram's prompt box holds 10,000 characters and drops trailing elements first. */
const MAX_PROMPT_CHARS = 9_600;

// ── Vocabulary ───────────────────────────────────────────────────────────────

const FONT_DESC: Record<FontKey, string> = {
  sans: "neutral sans-serif (Inter)",
  geometric: "geometric sans-serif (Montserrat)",
  serif: "high-contrast didone serif (Playfair Display)",
  elegant: "refined old-style serif (Cormorant Garamond)",
  dserif: "bold display serif (DM Serif Display)",
  display: "tall condensed sans-serif (Bebas Neue)",
  heavy: "ultra-heavy condensed grotesque sans (Anton)",
  condensed: "condensed sans-serif (Oswald)",
  grotesk: "modern grotesque sans (Space Grotesk)",
  calligraphy: "flowing formal calligraphy script (Great Vibes)",
  script: "handwritten brush script (Caveat)",
};

/** Faces that ship in a single weight: naming a weight would contradict the face. */
const SINGLE_WEIGHT = new Set<FontKey>(["heavy", "display", "dserif", "calligraphy"]);

const WEIGHT_WORD: Record<number, string> = {
  300: "light",
  400: "",
  500: "medium",
  600: "semibold",
  700: "bold",
  800: "extra-bold",
  900: "black",
};

/** A human colour name for a hex value, so descriptions read naturally ("crimson red"). */
/** `rgba(r, g, b, a)` (the engine uses it for scrims and shadows) → hex + alpha. */
function parseRgba(value: string): { hex: string; alpha: number } | null {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (!match) return null;
  const hex = `#${[match[1], match[2], match[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return { hex, alpha: match[4] === undefined ? 1 : Number(match[4]) };
}

export function colorName(value: string): string {
  const rgba = parseRgba(value);
  if (rgba) return rgba.alpha < 0.98 ? `translucent ${colorName(rgba.hex)} (${Math.round(rgba.alpha * 100)}%)` : colorName(rgba.hex);
  const hex = value;
  if (!isHex(hex)) return "neutral";
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  if (s < 0.12 || max - min < 0.06) {
    if (l > 0.93) return "white";
    if (l > 0.82) return "off-white";
    if (l > 0.6) return "light grey";
    if (l > 0.35) return "grey";
    if (l > 0.14) return "charcoal";
    return "near-black";
  }
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  const hue =
    h < 12 ? "red" : h < 30 ? "orange-red" : h < 45 ? "orange" : h < 58 ? "amber" : h < 70 ? "yellow" : h < 150 ? "green" :
    h < 185 ? "teal" : h < 205 ? "cyan" : h < 250 ? "blue" : h < 275 ? "indigo" : h < 300 ? "violet" : h < 335 ? "magenta" : "red";
  // Near-black colours read as their darkness, not their hue ("deep orange-red" tints a scrim).
  if (l < 0.13) return hue === "red" || hue === "orange-red" || hue === "orange" || hue === "amber" ? "near-black brown" : `near-black ${hue}`;
  const shade = l < 0.22 ? "deep " : l < 0.38 ? "dark " : l > 0.82 ? "pale " : l > 0.68 ? "light " : "";
  if (hue === "amber" && l < 0.55 && l > 0.25) return "gold";
  if (hue === "orange" && l < 0.3) return "brown";
  if (hue === "blue" && l < 0.3) return "navy";
  return `${shade}${hue}`;
}

/**
 * Colour in a description. The exact hex travels in the element's own color_palette
 * (Ideogram's colour channel), so the prose carries only the name — shorter prompts keep
 * every element inside the model's budget.
 */
const paint = (value: string) => colorName(value);

/** Decor from decor.ts: the only elements the prompt budget may drop. */
const ORNAMENT = new Set(["Confetti", "Dot grid", "Halftone", "Stripes", "Plus", "Sparkle", "Star", "Leaf", "Glow", "Grid", "Waves", "Cross", "Blob", "Frame"]);

// ── Geometry ─────────────────────────────────────────────────────────────────

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned bounds of a box rotated about its top-left corner (Konva's origin). */
function rotatedBounds(box: Box, degrees: number): Box {
  if (!degrees) return box;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [0, 0],
    [box.width, 0],
    [0, box.height],
    [box.width, box.height],
  ].map(([dx, dy]) => [box.x + dx! * cos - dy! * sin, box.y + dx! * sin + dy! * cos] as const);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** The visible ink box of a text node: wrapped lines × leading, narrowed to the widest line. */
function textBox(node: TextNode): Box {
  const lines = node.text.split("\n");
  const style = { font: node.font, weight: node.fontWeight, size: node.fontSize, uppercase: node.uppercase, letterSpacing: node.letterSpacing };
  const widest = Math.min(node.width, Math.max(...lines.map((line) => measure(line, style))));
  const x = node.align === "center" ? node.x + (node.width - widest) / 2 : node.align === "right" ? node.x + node.width - widest : node.x;
  return { x, y: node.y, width: widest, height: lines.length * node.fontSize * node.lineHeight };
}

/**
 * The box sent to the model. Small tilts keep the element's true (unrotated) size,
 * re-centred where the rotation puts it — the axis-aligned bounds of tilted lines
 * inflate and overlap their neighbours, and the model fills whatever box it is given.
 * The tilt itself is stated in the description.
 */
function nodeBox(node: FlyerNode): Box {
  const box = node.type === "text" ? textBox(node) : { x: node.x, y: node.y, width: node.width, height: node.height };
  if (!node.rotation) return box;
  const bounds = rotatedBounds(box, node.rotation);
  if (Math.abs(node.rotation) > 12) return bounds;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return { x: cx - box.width / 2, y: cy - box.height / 2, width: box.width, height: box.height };
}

/**
 * Maps page coordinates into the render frame. The render is a preset size slightly off
 * the page's aspect, so the page is fitted as a centred cover-crop: what the engine laid
 * out lands exactly where it was placed once the render is cropped back to the page.
 */
function frameMapper(doc: FlyerDoc, render: { width: number; height: number }) {
  const s = Math.max(render.width / doc.width, render.height / doc.height);
  const offX = (render.width - doc.width * s) / 2;
  const offY = (render.height - doc.height * s) / 2;
  const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  return (box: Box): [number, number, number, number] => [
    clamp(((box.y * s + offY) / render.height) * 1000),
    clamp(((box.x * s + offX) / render.width) * 1000),
    clamp((((box.y + box.height) * s + offY) / render.height) * 1000),
    clamp((((box.x + box.width) * s + offX) / render.width) * 1000),
  ];
}

function coversPage(doc: FlyerDoc, box: Box) {
  return box.x <= 2 && box.y <= 2 && box.x + box.width >= doc.width - 2 && box.y + box.height >= doc.height - 2;
}

// ── Element descriptions ─────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  Headline: "headline line",
  "Headline emphasis": "emphasised headline word (the focal point)",
  Eyebrow: "lead-in line above the headline",
  Subhead: "supporting subheadline",
  Body: "body paragraph",
  "Section title": "section heading",
  Brand: "brand name",
  "Brand mark": "brand monogram",
  CTA: "call-to-action label",
  Phone: "phone number",
  Website: "website address",
  Social: "social media handle",
  Contact: "contact detail",
  Detail: "event detail line",
  Details: "event detail line",
  Feature: "feature title",
  Bullet: "bullet list item",
  Tag: "small tag label",
  Script: "decorative script word",
  Footer: "footer line",
};

function sizeWord(node: TextNode, doc: FlyerDoc) {
  const scale = typeScale(doc.width, doc.height);
  const size = node.fontSize;
  if (size >= scale.hero * 1.15) return "massive";
  if (size >= scale.h1) return "very large";
  if (size >= scale.h2) return "large";
  if (size >= scale.h3) return "medium-large";
  if (size >= scale.lead) return "medium";
  if (size >= scale.body) return "small";
  return "very small";
}

/** A role from the words themselves, for nodes the engine named generically ("Text"). */
function contentRole(value: string) {
  const text = value.trim();
  if (/^[+()\d\s.-]{7,}$/.test(text)) return "phone number";
  if (/^\S+@\S+\.\S+$/.test(text)) return "email address";
  if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(text)) return "website address";
  if (/^@\w+$/.test(text)) return "social media handle";
  return null;
}

function roleOf(node: TextNode) {
  return ROLE_LABEL[node.name] ?? contentRole(node.text) ?? "supporting text";
}

/** Coarse page position — a second anchor for small elements besides their box. */
function positionWord(doc: FlyerDoc, box: Box) {
  const cx = (box.x + box.width / 2) / doc.width;
  const cy = (box.y + box.height / 2) / doc.height;
  const v = cy < 0.2 ? "top" : cy > 0.8 ? "bottom" : "middle";
  const h = cx < 0.35 ? "left" : cx > 0.65 ? "right" : "centre";
  return v === "middle" && h === "centre" ? "centre of the page" : `${v} ${h} of the page`;
}

function describeText(node: TextNode, doc: FlyerDoc, behind: FlyerNode | null, below: TextNode | null = null): string {
  const onButton = behind?.type === "shape" && behind.name === "CTA";
  const own = roleOf(node);
  const role = onButton
    ? "call-to-action button label"
    : own === "supporting text" && below
      ? `label directly above the ${roleOf(below)}`
      : own;
  const box = textBox(node);
  const small = box.width * box.height < doc.width * doc.height * 0.02;
  const onColor = behind ? fillOf(behind) : null;
  const weightWord = SINGLE_WEIGHT.has(node.font) ? "" : (WEIGHT_WORD[node.fontWeight] ?? "");
  const weight = weightWord ? `${weightWord} ` : "";
  const parts = [
    `${sizeWord(node, doc)} ${role}`,
    `${weight}${FONT_DESC[node.font]}`,
    node.uppercase ? "all caps" : null,
    node.italic ? "italic" : null,
    node.letterSpacing > node.fontSize * 0.08 ? "letter-spaced" : null,
    paint(node.fill),
    node.align === "center" ? "centred" : node.align === "right" ? "flush right" : "flush left",
    node.text.includes("\n") ? `exactly ${node.text.split("\n").length} lines as written` : null,
    node.rotation
      ? node.name.startsWith("Headline") || node.name === "Eyebrow"
        ? `the whole headline block (lead-in and every headline line) tilts together by the same ${Math.round(node.rotation)}°, lines parallel, never touching`
        : `tilted ${Math.round(node.rotation)}°`
      : null,
    onColor && isHex(onColor) ? `on the ${colorName(onColor)} ${onButton ? "button" : "shape"}` : null,
    small ? positionWord(doc, box) : null,
  ];
  return `${parts.filter(Boolean).join(", ")}.`;
}

function shapeKind(node: ShapeNode) {
  const minSide = Math.min(node.width, node.height);
  const ratio = Math.max(node.width, node.height) / Math.max(1, minSide);
  if (node.shape === "arc") {
    const sweep = node.arc?.sweep ?? 360;
    return sweep >= 359 ? "ring" : `${Math.round(sweep)}° ring arc`;
  }
  if (node.shape === "ellipse") return ratio < 1.1 ? (node.stroke && !opaque(node.fill) ? "outlined circle" : "circle") : "ellipse";
  if (node.cornerRadius >= minSide / 2 - 1) return ratio > 2.2 ? "pill-shaped button" : "circle";
  if (ratio > 8) return minSide <= 6 ? "hairline rule" : "accent bar";
  return node.cornerRadius > 0 ? "rounded rectangle" : "rectangle";
}

function opaque(fill: string) {
  return isHex(fill);
}

function describeShape(node: ShapeNode, doc: FlyerDoc): string {
  const kind = shapeKind(node);
  const fillText = node.gradient
    ? `smooth vertical gradient from ${paint(node.gradient.from)} to ${paint(node.gradient.to)}`
    : opaque(node.fill)
      ? `solid flat ${paint(node.fill)}`
      : "unfilled";
  const named = SHAPE_NAME[node.name];
  const parts = [
    node.name === "Scrim" ? "dark legibility scrim over the photo" : null,
    `${fillText} ${named ?? kind}`,
    node.stroke ? `crisp ${Math.max(1, Math.round(node.stroke.width))}px ${paint(node.stroke.color)} outline` : null,
    node.opacity < 0.98 ? `${Math.round(node.opacity * 100)}% opacity` : null,
    node.rotation ? `rotated ${Math.round(node.rotation)}°` : null,
    node.width * node.height > doc.width * doc.height * 0.25 ? "a large colour block of the layout" : null,
  ];
  return `${parts.filter(Boolean).join(", ")}.`;
}

/** Engine shape names whose role says more than their geometry. */
const SHAPE_NAME: Record<string, string> = {
  CTA: "call-to-action button",
  "Icon chip": "small icon chip",
  "Brand dot": "small brand dot",
  "Brand mark": "brand monogram badge",
  Bullet: "small bullet dot",
  Divider: "short thin divider line",
  Rule: "thin horizontal rule",
  "Row rule": "thin horizontal rule",
  Ring: "thick ring arc wrapping the portrait",
  Disc: "large solid disc bleeding off the edge",
  "Accent tab": "small accent tab",
};

const PATH_DESC: Record<string, string> = {
  Star: "small five-point star",
  Starburst: "starburst badge with crisp points",
  Bracket: "thick L-shaped corner bracket",
  Sparkle: "four-point sparkle",
  Leaf: "simple flat leaf",
  Blob: "smooth organic blob",
  Waves: "parallel wavy lines",
  Cross: "small × cross mark",
  Plus: "small plus mark",
  "Dot grid": "neat rectangular grid of small evenly spaced dots",
  Grid: "faint thin blueprint grid lines",
  Halftone: "halftone dot gradient",
  Stripes: "parallel diagonal stripes",
  Glow: "soft glowing circle",
};

/** `onShape`: a chip or card sits behind it; otherwise it is drawn straight on the page. */
function describePath(node: PathNode, onShape = false): string {
  const color = node.fill ?? node.stroke?.color ?? "#000000";
  const what = node.icon ? `simple ${node.stroke ? "line" : "solid"} icon: ${node.icon.replace(/-/g, " ")}` : (PATH_DESC[node.name] ?? "small flat vector ornament");
  return `${what}, ${paint(color)}${node.rotation ? `, rotated ${Math.round(node.rotation)}°` : ""}${onShape ? ", centred on the chip behind it" : ", drawn directly on the background with no tile or box behind it"}.`;
}

function describeImage(node: ImageNode, photo: string): string {
  const minSide = Math.min(node.width, node.height);
  const frame =
    node.cornerRadius >= minSide / 2 - 1 ? "a perfect circular frame" : node.cornerRadius > 0 ? "a rounded-corner rectangular frame" : "a sharp rectangular frame";
  return [
    `Photograph of ${photo} (no legible text, signs or logos in the photo), cropped to fill ${frame}`,
    node.stroke ? `with a clean ${Math.max(2, Math.round(node.stroke.width))}px ${paint(node.stroke.color)} border` : null,
    node.rotation ? `tilted ${Math.round(node.rotation)}°` : null,
    node.shadow ? "with a soft drop shadow" : null,
  ]
    .filter(Boolean)
    .join(", ")
    .concat(".");
}

/** Decorative repeats (confetti, dot grids, halftone…) are described once, as a group. */
const GROUP_DESC: Record<string, string> = {
  Confetti: "scattered small flat paper confetti pieces",
  "Dot grid": "neat grid of small evenly spaced dots",
  Halftone: "halftone dot gradient",
  Stripes: "set of parallel diagonal stripes",
  Plus: "small plus marks arranged on a grid",
  Sparkle: "a few four-point sparkles",
  Star: "a few small stars",
  Leaf: "scattered flat leaves",
  Glow: "soft out-of-focus light circles",
  Grid: "faint thin blueprint grid lines",
  Waves: "parallel wavy lines",
  Cross: "small cross marks",
  Blob: "soft organic blob shapes",
};

const fillOf = (node: FlyerNode) =>
  node.type === "text" ? node.fill : node.type === "shape" ? (node.gradient?.from ?? node.fill) : node.type === "path" ? (node.fill ?? node.stroke?.color ?? null) : null;

// ── Compile ──────────────────────────────────────────────────────────────────

interface Ranked {
  element: IdeogramElement;
  /** Higher = listed earlier (Ideogram drops trailing elements of long prompts). */
  weight: number;
  /** Decor and grouped repeats can be dropped to fit the prompt budget. */
  optional: boolean;
}

export function compileRenderPrompt(doc: FlyerDoc, meta: RenderMeta): IdeogramPrompt {
  const render = RENDER_SIZES[doc.format];
  const toBox = frameMapper(doc, render);
  const area = doc.width * doc.height;
  const palette = meta.palette;
  const photos = meta.photoPrompts ?? [];
  let photoIndex = 0;

  const background: string[] = [`Flat solid ${paint(doc.background)} page`];
  /** Boxes of everything that occupies space (for finding the negative space). */
  const occupied: Box[] = [];
  const ranked: Ranked[] = [];
  const visible = doc.nodes.filter((node) => !node.hidden && node.opacity > 0.04);

  // Group decorative repeats by name.
  const counts = new Map<string, number>();
  for (const node of visible) if (node.type !== "text" && node.type !== "image") counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
  const grouped = new Map<string, FlyerNode[]>();

  visible.forEach((node, index) => {
    const box = nodeBox(node);
    if (node.type !== "text" && node.type !== "image" && (counts.get(node.name) ?? 0) >= 3 && GROUP_DESC[node.name]) {
      grouped.set(node.name, [...(grouped.get(node.name) ?? []), node]);
      return;
    }

    if (node.type === "image") {
      const subjectText = photos[photoIndex++ % Math.max(1, photos.length)] ?? `a scene that fits ${meta.subject}`;
      // The audience should see themselves: photos are set in the flyer's market.
      const subject = meta.region ? `${subjectText}, photographed in ${meta.region} with local people` : subjectText;
      if (coversPage(doc, box)) {
        // A photo backdrop is the most important "element": state it first, full frame.
        background[0] = `A full-bleed photograph of ${subject} fills the entire page edge to edge`;
        ranked.push({
          element: { type: "obj", bbox: [0, 0, 1000, 1000], desc: `One single continuous full-bleed photograph of ${subject}, filling the whole frame edge to edge as the backdrop behind every other element; not a collage, no panels, frames, borders or dividing lines.` },
          weight: 5000,
          optional: false,
        });
        return;
      }
      occupied.push(box);
      ranked.push({ element: { type: "obj", bbox: toBox(box), desc: describeImage(node, subject) }, weight: 800 + (node.width * node.height) / area, optional: false });
      return;
    }

    if (node.type === "shape" && coversPage(doc, box) && !node.gradient) {
      background.push(`covered by ${opaque(node.fill) ? paint(node.fill) : "a"} ${node.opacity < 0.98 ? `layer at ${Math.round(node.opacity * 100)}% opacity` : "fill"}`);
      return;
    }
    if (node.type === "shape" && coversPage(doc, box) && node.gradient) {
      background.push(`under a smooth dark gradient scrim from ${paint(node.gradient.from)} to ${paint(node.gradient.to)} that keeps the type legible`);
      return;
    }

    // Large fields (split panels, colour blocks) and faint grid lines are surfaces, not content.
    const surfaceLike = (node.type === "shape" && node.width * node.height > area * 0.3) || node.name === "Grid";
    if (!surfaceLike) occupied.push(box);

    if (node.type === "text") {
      // The shape a text sits on, if any (buttons, colour cards), helps the model place it.
      const behind = visible
        .slice(0, index)
        .reverse()
        .find((other) => other.type === "shape" && other.width * other.height < area * 0.5 && contains(nodeBox(other), box));
      // A small line sitting right above another, on the same left edge, is its label.
      const below = visible.find(
        (other): other is TextNode =>
          other !== node && other.type === "text" && Math.abs(other.x - node.x) < 4 && other.y > node.y && other.y - (box.y + box.height) < node.fontSize * 1.2 && other.fontSize > node.fontSize,
      );
      ranked.push({
        element: { type: "text", bbox: toBox(box), text: node.uppercase ? node.text.toUpperCase() : node.text, desc: describeText(node, doc, behind ?? null, below ?? null), color_palette: [node.fill.toUpperCase()] },
        weight: 1000 + node.fontSize,
        optional: false,
      });
      return;
    }

    const fill = fillOf(node);
    const sizeShare = (box.width * box.height) / area;
    ranked.push({
      element: {
        type: "obj",
        bbox: toBox(box),
        desc:
          node.type === "shape"
            ? describeShape(node, doc)
            : describePath(node, visible.slice(0, index).some((other) => other.type === "shape" && other.width * other.height < area * 0.3 && contains(nodeBox(other), box))),
        ...(fill && isHex(fill) && { color_palette: [fill.toUpperCase()] }),
      },
      weight: 100 + sizeShare * 600,
      // Only decor is expendable: bullets, chips and tabs are structure even when tiny.
      optional: ORNAMENT.has(node.name),
    });
  });

  // Repeats scattered over the page are described as local clusters, so ornament stays
  // in the free space the engine chose for it instead of spreading across the layout.
  const reach = Math.min(doc.width, doc.height) * 0.08;
  for (const [name, nodes] of grouped) {
    for (const cluster of clusters(nodes.map((node) => ({ node, box: nodeBox(node) })), reach)) {
      const box = union(cluster.map((c) => c.box));
      const colors = [...new Set(cluster.map((c) => fillOf(c.node)).filter((c): c is string => Boolean(c && isHex(c))).map((c) => c.toUpperCase()))].slice(0, 5);
      ranked.push({
        element: {
          type: "obj",
          bbox: toBox(box),
          desc: `${cluster.length === 1 ? (PATH_DESC[name] ?? GROUP_DESC[name]) : GROUP_DESC[name]}, ${colors.map(colorName).join(" and ") || "soft tone"}, subtle ornament drawn directly on the background (no tile behind it), never behind text.`,
          ...(colors.length && { color_palette: colors }),
        },
        weight: 50 + cluster.length,
        optional: true,
      });
    }
  }

  // Whitespace is a design element: declare the large empty regions explicitly, or the
  // model fills them with invented copy (or with words from this prompt).
  // Every box reads as a panel to the model, so regions are described as seamless; over a
  // photo backdrop they are skipped entirely (they turn one photo into a collage) and the
  // backdrop element itself insists on one continuous image. Boxes for empty space get drawn as
  // outlined panels, so by default the zones are named in the background prose instead.
  const emptyZones: string[] = [];
  for (const region of emptyRegions(doc, occupied)) {
    const surface = surfaceAt(visible, doc, region);
    if (surface.includes("photograph")) continue;
    if (meta.negativeSpace === "boxes") {
      ranked.push({
        element: {
          type: "obj",
          bbox: toBox(region),
          desc: `Intentionally empty negative space: the ${surface} continues seamlessly here, with no border, outline, panel or dividing line. No text, words, icons, photos or shapes.`,
        },
        weight: 950,
        optional: false,
      });
    } else {
      emptyZones.push(`the ${positionWord(doc, region).replace(" of the page", "")} (${surface})`);
    }
  }
  if (emptyZones.length) {
    background.push(`deliberate negative space: ${[...new Set(emptyZones)].join(", ")} stay completely empty and open, with no outlines, boxes, panels or lines drawn there`);
  }

  ranked.sort((a, b) => b.weight - a.weight);

  const archetype = ARCHETYPES[meta.archetype];
  const backdrop = ranked.some((r) => r.weight === 5000);
  const formatSpec = FORMATS[doc.format];
  // The headline may be split across nodes (lines, an emphasised word): read them in order.
  const texts = visible.filter((n): n is TextNode => n.type === "text");
  const headlineNodes = texts.filter((n) => n.name.startsWith("Headline")).sort((a, b) => a.y - b.y || a.x - b.x);
  const headline = (headlineNodes.length ? headlineNodes : texts.sort((a, b) => b.fontSize - a.fontSize).slice(0, 1))
    .map((n) => n.text.replace(/\n/g, " "))
    .join(" ");
  const colors = [...new Set([palette.bg, palette.primary, palette.accent, palette.ink, palette.dark, palette.surface, palette.muted, palette.accent2, palette.tint, doc.background].map((c) => c.toUpperCase()))].slice(0, 16);

  const prompt: IdeogramPrompt = {
    high_level_description: backdrop
      ? `A professionally designed ${formatSpec.label.toLowerCase()} flyer (${formatSpec.detail}) for ${meta.subject}${headline ? `, headlined "${headline}"` : ""}: one continuous atmospheric full-bleed photograph with a centred typographic lockup over it, precise typography and generous breathing room. Only the listed text appears; the photograph shows through everywhere else.`
      : `A professionally designed ${formatSpec.label.toLowerCase()} flyer (${formatSpec.detail}) for ${meta.subject}${headline ? `, headlined "${headline}"` : ""}: a clean, flat, print-ready graphic design layout in the ${archetype.name.toLowerCase()} style, with precise typography, crisp geometric shapes and a strict grid. Only the listed text appears; empty areas stay empty.`,
    style_description: {
      aesthetics: [palette.mood, ...(meta.tone ?? [])].join(", ") + `. ${palette.psychology}`,
      lighting: "Flat, even print lighting; no dramatic lighting, glow, lens flare, bokeh or 3D shading on the graphic elements.",
      medium: "graphic design — professional print flyer, vector layout",
      // Principles apply per layout: over a photo backdrop a designer drops the grid and
      // photo frames (they invite collages) and lets one image carry the mood.
      art_style: backdrop
        ? `Contemporary professional photo poster, ${meta.pairing.mood.toLowerCase()} type voice; ${principleCues(PRINCIPLE_IDS.filter((id) => id !== "grid" && id !== "imagery")).join("; ")}. Typography and thin graphic accents over one photograph: no collage, no inset photos, no panels or frames, not a mockup.`
        : `Contemporary professional flyer, ${meta.pairing.mood.toLowerCase()} type voice; ${principleCues().join("; ")}. Flat vector graphic design: not a painting, not 3D, not a mockup, no paper texture, no perspective.`,
      color_palette: colors,
    },
    compositional_deconstruction: {
      background: `${background.join(", ")}. Any area without a listed element shows only this background: no other text, words, sections, icons, photos, shapes or textures.`,
      elements: ranked.map((r) => r.element),
    },
  };

  // Fit Ideogram's prompt budget: drop ornament first, then the smallest shapes. Text and
  // photos are never dropped — the words are the message.
  const elements = prompt.compositional_deconstruction.elements;
  const over = () => JSON.stringify(prompt).length > MAX_PROMPT_CHARS;
  const passes = [(r: Ranked) => r.optional, (r: Ranked) => r.element.type === "obj" && r.weight < 800];
  for (const droppable of passes) {
    for (let i = ranked.length - 1; over() && i >= 0; i--) {
      if (!droppable(ranked[i]!)) continue;
      elements.splice(elements.indexOf(ranked[i]!.element), 1);
      ranked.splice(i, 1);
    }
  }
  return prompt;
}

/**
 * The large empty rectangles a layout leaves, found on an occupancy grid: repeatedly
 * take the biggest all-empty rectangle (maximal rectangle in a histogram) until none is
 * big enough to matter. Thin margins are not reported — only real negative space.
 */
function emptyRegions(doc: FlyerDoc, occupied: Box[], max = 4): Box[] {
  const cols = 32;
  const cell = doc.width / cols;
  const rows = Math.round(doc.height / cell);
  const pad = cell * 0.5;
  const full: boolean[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const x = c * cell;
      const y = r * cell;
      return occupied.some((b) => x < b.x + b.width + pad && x + cell > b.x - pad && y < b.y + b.height + pad && y + cell > b.y - pad);
    }),
  );
  const short = Math.min(doc.width, doc.height);
  const minW = doc.width * 0.25;
  const minH = short * 0.12;
  const minArea = doc.width * doc.height * 0.04;
  const found: Box[] = [];

  for (let n = 0; n < max; n++) {
    let best: Box | null = null;
    const heights: number[] = new Array(cols).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) heights[c] = full[r]![c] ? 0 : heights[c]! + 1;
      // Largest rectangle under this row's histogram.
      const stack: number[] = [];
      for (let c = 0; c <= cols; c++) {
        const h = c === cols ? 0 : heights[c]!;
        while (stack.length > 0 && heights[stack[stack.length - 1]!]! >= h) {
          const top = stack.pop()!;
          const height = heights[top]!;
          const left = stack.length > 0 ? stack[stack.length - 1]! + 1 : 0;
          const box = { x: left * cell, y: (r - height + 1) * cell, width: (c - left) * cell, height: height * cell };
          const size = box.width * box.height;
          if (box.width >= minW && box.height >= minH && size >= minArea && (!best || size > best.width * best.height)) best = box;
        }
        stack.push(c);
      }
    }
    if (!best) break;
    found.push(best);
    for (let r = Math.round(best.y / cell); r < Math.round((best.y + best.height) / cell); r++) {
      for (let c = Math.round(best.x / cell); c < Math.round((best.x + best.width) / cell); c++) full[r]![c] = true;
    }
  }
  return found;
}

/** What shows through at a region: the topmost large field or backdrop under its centre. */
function surfaceAt(nodes: FlyerNode[], doc: FlyerDoc, region: Box) {
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  for (const node of [...nodes].reverse()) {
    if (node.type !== "shape" && node.type !== "image") continue;
    if (node.width * node.height < doc.width * doc.height * 0.2) continue;
    const box = nodeBox(node);
    if (cx < box.x || cx > box.x + box.width || cy < box.y || cy > box.y + box.height) continue;
    if (node.type === "image") return "photograph backdrop";
    if (node.gradient) return "darkened photograph backdrop";
    if (isHex(node.fill)) return `plain ${colorName(node.fill)} background`;
  }
  return `plain ${colorName(doc.background)} background`;
}

/** Single-link clustering: boxes closer than `reach` (edge to edge) share a cluster. */
function clusters<T extends { box: Box }>(items: T[], reach: number): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const near = groups.filter((group) => group.some((other) => gap(other.box, item.box) <= reach));
    for (const group of near) groups.splice(groups.indexOf(group), 1);
    groups.push([item, ...near.flat()]);
  }
  return groups;
}

function gap(a: Box, b: Box) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.hypot(dx, dy);
}

function contains(outer: Box, inner: Box) {
  return inner.x >= outer.x - 2 && inner.y >= outer.y - 2 && inner.x + inner.width <= outer.x + outer.width + 2 && inner.y + inner.height <= outer.y + outer.height + 2;
}

function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}
