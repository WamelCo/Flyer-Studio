/**
 * WCAG contrast audit for the design engine (.claude/rules/ai-generation.md: 4.5:1 body,
 * 3:1 display). Composes every layout × palette × type pairing × format, then measures
 * each text line against whatever the engine actually placed behind it — solid fills,
 * gradients and translucent layers composited in z-order.
 *   pnpm audit:contrast            summary + first failures, exit 1 on any failure
 *   pnpm audit:contrast --all      every failure
 *
 * Text over a photograph is skipped (the photo is unknown here); the scrim that sits
 * between them is what the layouts rely on.
 */
import { ARCHETYPE_IDS } from "../src/archetypes";
import { contrast, CONTRAST, hexToRgb, rgbToHex, type RGB } from "../src/color";
import { composeDesign } from "../src/compose";
import type { DesignCopy, StockPhoto } from "../src/engine";
import { wrap } from "../src/metrics";
import { DECOR_LEVELS, MOTIF_IDS, type Decor } from "../src/decor";
import { PALETTE_IDS } from "../src/palettes";
import { PAIRING_IDS, typeScale } from "../src/typography";
import type { FlyerDoc, FlyerFormat, FlyerNode, TextNode } from "../src/canvas/types";

const FORMATS: FlyerFormat[] = ["poster", "square", "story", "landscape"];

const blank: DesignCopy = {
  brand: null, eyebrow: null, headline: "", emphasis: null, subhead: null, bodyTitle: null, body: null,
  bullets: [], features: [], details: [], cta: null,
  contact: { phone: null, email: null, website: null, address: null, social: [] },
};

const COPIES: Record<string, DesignCopy> = {
  rich: {
    ...blank,
    brand: "Northwind",
    eyebrow: "Find your",
    headline: "Boost productivity and profit",
    emphasis: "profit",
    subhead: "Strategy for growing teams",
    bodyTitle: "Why choose us?",
    body: "We deliver measurable results with a hands-on team that plans, builds and reviews every step with you.",
    bullets: ["Executive coaching", "Risk management", "Growth strategy"],
    features: [
      { title: "Planning", text: "Long-term strategies that hold up.", icon: "target" },
      { title: "Research", text: "Markets, customers and competition.", icon: "search" },
      { title: "Finance", text: "Budgets that reduce cost.", icon: "bar-chart" },
    ],
    details: [
      { icon: "calendar", text: "Saturday, 10am–4pm" },
      { icon: "map-pin", text: "Riverside Hall" },
    ],
    cta: "Book now",
    contact: { phone: "800.123.4567", email: "hello@example.com", website: "example.com", address: null, social: ["@northwind"] },
  },
  offer: {
    ...blank,
    eyebrow: "This weekend only",
    headline: "Summer sale 50% off",
    emphasis: "50%",
    subhead: "Everything in store",
    details: [{ icon: "calendar", text: "Fri–Sun" }],
    cta: "Shop now",
    contact: { ...blank.contact, website: "example.com" },
  },
};

const photo = (w: number, h: number): StockPhoto => ({ url: `https://images.unsplash.com/test-${w}x${h}`, width: w, height: h, credit: { name: "Test", url: "https://unsplash.com" } });
const PHOTO_SETS = { none: [] as StockPhoto[], photos: [photo(1200, 1500), photo(1500, 1000), photo(1000, 1500), photo(1200, 1200)] };

// ── Colour compositing ───────────────────────────────────────────────────────

type Paint = { rgb: RGB; a: number } | "photo" | null;

function parse(color: string): { rgb: RGB; a: number } | null {
  if (!color || color === "transparent") return null;
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1]!.split(",").map((s) => s.trim());
    return { rgb: [Number(r), Number(g), Number(b)], a: Number(a) };
  }
  return { rgb: hexToRgb(color), a: 1 };
}

const over = (top: RGB, a: number, under: RGB): RGB => [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)) as RGB;

/** Polygons from paths made only of absolute M/L/H/V/Z commands; null for curves or arcs. */
function straightPolygons(node: Extract<FlyerNode, { type: "path" }>): [number, number][][] | null {
  const polygons: [number, number][][] = [];
  for (const d of node.paths) {
    if (/[^MLHVZ\d\s.,-]/.test(d)) return null;
    let current: [number, number][] = [];
    let at: [number, number] = [0, 0];
    for (const [, cmd, args] of d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
      const n = (args ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (cmd === "M") {
        if (current.length) polygons.push(current);
        at = [n[0]!, n[1]!];
        current = [at];
      } else if (cmd === "L") at = [n[0]!, n[1]!];
      else if (cmd === "H") at = [n[0]!, at[1]];
      else if (cmd === "V") at = [at[0], n[0]!];
      if (cmd === "L" || cmd === "H" || cmd === "V") current.push(at);
      if (cmd === "Z" && current.length) {
        polygons.push(current);
        current = [];
      }
    }
    if (current.length) polygons.push(current);
  }
  return polygons.length ? polygons : null;
}

function insidePolygon(points: [number, number][], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function contains(node: FlyerNode, x: number, y: number) {
  if (node.hidden || node.opacity <= 0) return false;
  if (node.type === "text") return false;
  const { x: nx, y: ny, width, height } = node;
  if (Math.abs(node.rotation) > 0.5) {
    // Rotate the point into the node's frame (Konva rotates around the node's x/y).
    const t = (-node.rotation * Math.PI) / 180;
    const dx = x - nx;
    const dy = y - ny;
    return contains({ ...node, rotation: 0 }, nx + dx * Math.cos(t) - dy * Math.sin(t), ny + dx * Math.sin(t) + dy * Math.cos(t));
  }
  if (x < nx || y < ny || x > nx + width || y > ny + height) return false;
  if (node.type === "shape" && node.shape === "ellipse") {
    const rx = width / 2;
    const ry = height / 2;
    return ((x - nx - rx) / rx) ** 2 + ((y - ny - ry) / ry) ** 2 <= 1;
  }
  if (node.type === "shape" && node.shape === "arc") return false; // thin ring segments
  if (node.type === "path") {
    // Filled artwork (bursts, blobs): count its inner area; stroke-only icons never sit behind copy.
    if (!node.fill) return false;
    // Straight-edged fields (diagonal splits, cut corners) are tested exactly.
    const polygons = straightPolygons(node);
    if (polygons) {
      const px = ((x - nx) / width) * node.viewBox[0];
      const py = ((y - ny) / height) * node.viewBox[1];
      return polygons.some((points) => insidePolygon(points, px, py));
    }
    const cx = nx + width / 2;
    const cy = ny + height / 2;
    return Math.abs(x - cx) < width * 0.35 && Math.abs(y - cy) < height * 0.35;
  }
  return true;
}

function paintOf(node: FlyerNode, y: number, x = 0): Paint {
  if (node.type === "image") return node.src ? "photo" : { rgb: [200, 200, 200], a: 1 };
  if (node.type === "text") return null;
  if (node.type === "shape" && node.gradient) {
    const t = Math.max(0, Math.min(1, node.gradient.horizontal ? (x - node.x) / node.width : (y - node.y) / node.height));
    const from = parse(node.gradient.from)!;
    const to = parse(node.gradient.to)!;
    return { rgb: over(to.rgb, t, from.rgb), a: (from.a * (1 - t) + to.a * t) * node.opacity };
  }
  const fill = parse(node.type === "path" ? (node.fill ?? "transparent") : node.fill);
  return fill ? { rgb: fill.rgb, a: fill.a * node.opacity } : null;
}

/** The colour behind (x, y) under node `index`, or "photo" if a photograph shows through. */
function backgroundAt(doc: FlyerDoc, index: number, x: number, y: number): RGB | "photo" {
  const layers: { rgb: RGB; a: number }[] = [];
  for (let j = index - 1; j >= 0; j--) {
    const node = doc.nodes[j]!;
    if (!contains(node, x, y)) continue;
    const paint = paintOf(node, y, x);
    if (!paint) continue;
    if (paint === "photo") {
      // Only translucent layers above it: the photo decides the contrast.
      return "photo";
    }
    layers.push(paint);
    if (paint.a >= 0.999) break;
  }
  let color = layers.length && layers.at(-1)!.a >= 0.999 ? layers.pop()!.rgb : hexToRgb(doc.background);
  for (let k = layers.length - 1; k >= 0; k--) color = over(layers[k]!.rgb, layers[k]!.a, color);
  return color;
}

// ── Audit ────────────────────────────────────────────────────────────────────

interface Failure {
  where: string;
  node: string;
  text: string;
  ratio: number;
  required: number;
  colors: string;
}

function auditDoc(doc: FlyerDoc, where: string, failures: Failure[]) {
  const body = typeScale(doc.width, doc.height).body;
  let checked = 0;
  let skipped = 0;
  doc.nodes.forEach((node, index) => {
    if (node.type !== "text" || node.hidden || node.opacity <= 0 || !node.text.trim()) return;
    const large = node.fontSize >= body * 2 || (node.fontSize >= body * 1.5 && node.fontWeight >= 700);
    const required = large ? CONTRAST.large : CONTRAST.body;
    const ink = parse(node.fill);
    if (!ink) return;
    let worst: { ratio: number; colors: string } | null = null;
    for (const [px, py] of samplePoints(node)) {
      const bg = backgroundAt(doc, index, px, py);
      if (bg === "photo") {
        skipped++;
        continue;
      }
      checked++;
      const fg = rgbToHex(over(ink.rgb, ink.a * node.opacity, bg));
      const ratio = contrast(fg, rgbToHex(bg));
      if (!worst || ratio < worst.ratio) worst = { ratio, colors: `${fg} on ${rgbToHex(bg)}` };
    }
    if (worst && worst.ratio < required - 0.005) {
      failures.push({ where, node: node.name, text: node.text.replace(/\s+/g, " ").slice(0, 32), ratio: worst.ratio, required, colors: worst.colors });
    }
  });
  return { checked, skipped };
}

/** Points along each wrapped line where glyphs actually are (respecting alignment). */
function samplePoints(node: TextNode): [number, number][] {
  const style = { font: node.font, weight: node.fontWeight, size: node.fontSize, uppercase: node.uppercase, letterSpacing: node.letterSpacing };
  const lines = wrap(node.text, style, node.width + 1);
  const points: [number, number][] = [];
  const lineHeight = node.fontSize * node.lineHeight;
  const rad = (node.rotation * Math.PI) / 180;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const w = Math.min(node.width, measureLine(line, style));
    const start = node.align === "center" ? (node.width - w) / 2 : node.align === "right" ? node.width - w : 0;
    const ly = i * lineHeight + lineHeight / 2;
    for (const f of [0.1, 0.5, 0.9]) {
      const lx = start + w * f;
      // Into page space (Konva rotates around the node origin).
      points.push([node.x + lx * Math.cos(rad) - ly * Math.sin(rad), node.y + lx * Math.sin(rad) + ly * Math.cos(rad)]);
    }
  });
  return points;
}

import { measure as measureLine } from "../src/metrics";

const failures: Failure[] = [];
let docs = 0;
let checked = 0;
let skipped = 0;
for (const archetype of ARCHETYPE_IDS) {
  for (const palette of PALETTE_IDS) {
    for (const pairing of PAIRING_IDS) {
      for (const format of FORMATS) {
        for (const [copyName, copy] of Object.entries(COPIES)) {
          for (const [photoName, photos] of Object.entries(PHOTO_SETS)) {
            // Every motif and level gets exercised: decoration must never sit behind a word.
            const k = docs % MOTIF_IDS.length;
            const decor: Decor = { level: DECOR_LEVELS[docs % DECOR_LEVELS.length]!, motifs: [...MOTIF_IDS.slice(k), ...MOTIF_IDS.slice(0, k)].slice(0, 3) };
            const doc = composeDesign({ format, copy, variant: { archetype, palette, pairing }, photos, decor });
            const result = auditDoc(doc, `${archetype} / ${palette} / ${pairing} / ${format} / ${copyName} / ${photoName}`, failures);
            docs++;
            checked += result.checked;
            skipped += result.skipped;
          }
        }
      }
    }
  }
}

console.log(`${docs} designs, ${checked} text samples checked, ${skipped} over photos skipped.`);
if (!failures.length) {
  console.log("✓ Every text element meets WCAG contrast (4.5:1 body, 3:1 display).");
  process.exit(0);
}

// Group by the decision that caused it: layout × palette × node.
const groups = new Map<string, Failure[]>();
for (const f of failures) {
  const [archetype, palette] = f.where.split(" / ");
  const key = `${archetype} · ${palette} · ${f.node}`;
  groups.set(key, [...(groups.get(key) ?? []), f]);
}
console.log(`✗ ${failures.length} failing text elements in ${groups.size} layout · palette · element groups:`);
const rows = [...groups.entries()].sort((a, b) => Math.min(...a[1].map((f) => f.ratio)) - Math.min(...b[1].map((f) => f.ratio)));
for (const [key, list] of process.argv.includes("--all") ? rows : rows.slice(0, 40)) {
  const worst = list.reduce((a, b) => (a.ratio < b.ratio ? a : b));
  console.log(`  ${key.padEnd(52)} ${worst.ratio.toFixed(2)}:1 < ${worst.required}  ${worst.colors}  "${worst.text}"  (${list.length}×)`);
}
process.exit(1);
