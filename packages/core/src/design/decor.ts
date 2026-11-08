import type { FlyerNode } from "../canvas/types";
import { contrast, hexToRgb, isDark, isHex, mix, rgbToHex } from "./color";
import { circle, dotGrid, inkOn, path, rect, ring, type Ctx } from "./engine";
import ICONS from "./icons.json";
import { wrap } from "./metrics";

/**
 * The spark: decorative motifs a designer adds once the type is set — confetti for a
 * party, bokeh for a night out, a hairline frame for a gala. The art director picks the
 * motifs and how much to use; this module finds the free space the layout left and
 * places them there, behind every word, so they add energy without costing legibility.
 */

export const MOTIF_IDS = [
  "confetti",
  "sparkles",
  "stars",
  "bokeh",
  "rings",
  "dots",
  "halftone",
  "stripes",
  "waves",
  "leaves",
  "plus",
  "blobs",
  "frame",
  "grid",
] as const;
export type MotifId = (typeof MOTIF_IDS)[number];

export const DECOR_LEVELS = ["minimal", "balanced", "bold"] as const;
export type DecorLevel = (typeof DECOR_LEVELS)[number];

export interface Decor {
  level: DecorLevel;
  motifs: MotifId[];
}

/** What each motif says — shown to the art director. */
export const MOTIFS: Record<MotifId, string> = {
  confetti: "scattered paper confetti — celebration, birthdays, launches, kids",
  sparkles: "four-point sparkles around the headline — magic, beauty, premium, festive",
  stars: "small filled stars — kids, awards, nightlife, holidays",
  bokeh: "soft glowing light circles — evenings, concerts, galas, winter",
  rings: "concentric rings bleeding off a corner — music, tech, modern events",
  dots: "neat dot grids — corporate, clinics, education, structure",
  halftone: "halftone dot gradient in a corner — retro, sport, sales, posters",
  stripes: "diagonal stripes in a corner — sales, sport, construction, urgency",
  waves: "parallel wavy lines — travel, beach, wellness, flow",
  leaves: "scattered leaves — food, autumn, nature, organic, gardens",
  plus: "plus marks — health, science, tech, precision",
  blobs: "soft organic blobs bleeding off corners — friendly, community, beauty",
  frame: "hairline inset frame — elegance, weddings, luxury, invitations",
  grid: "faint blueprint grid — architecture, real estate, tech",
};

// Minimal still gets two quiet motifs: restraint, not emptiness.
const LEVEL = { minimal: { motifs: 2, amount: 0.55 }, balanced: { motifs: 2, amount: 1 }, bold: { motifs: 3, amount: 1.6 } } as const;

export function decorate(ctx: Ctx, decor: Decor, seed: string) {
  const level = LEVEL[decor.level];
  const motifs = [...new Set(decor.motifs)].slice(0, level.motifs);
  if (!motifs.length) return;

  // Decor goes behind all type, above any background field or photograph.
  const firstText = ctx.nodes.findIndex((node) => node.type === "text");
  const insertAt = firstText === -1 ? ctx.nodes.length : firstText;
  const space = new Space(ctx, insertAt, random(seed));
  const before = ctx.nodes.length;
  for (const motif of motifs) PAINTERS[motif](ctx, space, level.amount);
  const added = ctx.nodes.splice(before);
  for (const node of added) node.locked = false;
  ctx.nodes.splice(insertAt, 0, ...added);
}

// ── Free space ──────────────────────────────────────────────────────────────

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;

function textHeight(node: Extract<FlyerNode, { type: "text" }>) {
  const style = { font: node.font, weight: node.fontWeight, size: node.fontSize, uppercase: node.uppercase, letterSpacing: node.letterSpacing };
  return wrap(node.text, style, node.width + 1).length * node.fontSize * node.lineHeight;
}

/** Axis-aligned bounds of a node, rotation included (Konva rotates about x/y). */
function bounds(node: FlyerNode): Box {
  const width = node.width;
  const height = node.type === "text" ? textHeight(node) : node.height;
  if (!node.rotation) return { x: node.x, y: node.y, width, height };
  const t = (node.rotation * Math.PI) / 180;
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([dx, dy]) => [node.x + dx! * Math.cos(t) - dy! * Math.sin(t), node.y + dx! * Math.sin(t) + dy! * Math.cos(t)]);
  const xs = corners.map((c) => c[0]!);
  const ys = corners.map((c) => c[1]!);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

class Space {
  readonly occupied: Box[];
  readonly headline: Box | null;
  readonly page: Box;

  constructor(
    readonly ctx: Ctx,
    readonly under: number,
    readonly rand: () => number,
  ) {
    const { W, H } = ctx;
    this.page = { x: 0, y: 0, width: W, height: H };
    const pageArea = W * H;
    const content = ctx.nodes.filter((node) => {
      if (node.hidden || node.opacity <= 0) return false;
      if (node.type === "text") return true;
      // Full-bleed fields, scrims and background photos are surfaces to decorate, not content.
      return !node.locked && node.width * node.height < pageArea * 0.3;
    });
    this.occupied = content.map(bounds);
    const texts = ctx.nodes.filter((n): n is Extract<FlyerNode, { type: "text" }> => n.type === "text");
    const biggest = texts.reduce<Extract<FlyerNode, { type: "text" }> | null>((a, b) => (!a || b.fontSize > a.fontSize ? b : a), null);
    this.headline = biggest ? bounds(biggest) : null;
  }

  /** Clear of content (by `pad`) and, unless it may bleed, inside the page. */
  free(box: Box, pad: number, bleed = false) {
    if (!bleed && (box.x < 0 || box.y < 0 || box.x + box.width > this.ctx.W || box.y + box.height > this.ctx.H)) return false;
    const visible = bleed ? intersect(box, this.page) : box;
    if (!visible) return false;
    return !this.occupied.some((o) => overlaps(visible, o, pad));
  }

  /** A random free spot for a w×h piece; `near` pulls it towards a box, `edges` towards the page edges. */
  find(w: number, h: number, options: { pad: number; near?: Box | null; edges?: boolean; tries?: number }): Box | null {
    const { W, H } = this.ctx;
    for (let i = 0; i < (options.tries ?? 40); i++) {
      let x: number;
      let y: number;
      if (options.near) {
        const n = options.near;
        const reach = Math.max(n.height, this.ctx.u * 10);
        x = n.x - reach * 0.6 + this.rand() * (n.width + reach * 1.2) - w / 2;
        y = n.y - reach * 0.6 + this.rand() * (n.height + reach * 1.2) - h / 2;
      } else if (options.edges && this.rand() < 0.75) {
        const band = Math.min(W, H) * 0.2;
        const side = Math.floor(this.rand() * 4);
        x = side === 1 ? W - band + this.rand() * (band - w) : side === 3 ? this.rand() * (band - w) : this.rand() * (W - w);
        y = side === 0 ? this.rand() * (band - h) : side === 2 ? H - band + this.rand() * (band - h) : this.rand() * (H - h);
      } else {
        x = this.rand() * (W - w);
        y = this.rand() * (H - h);
      }
      const box = { x, y, width: w, height: h };
      if (this.free(box, options.pad)) return box;
    }
    if (options.near) return null;
    // Random tries missed (tight layouts): sweep a shuffled grid of positions instead.
    const step = Math.max(this.ctx.u * 3, Math.min(w, h) / 2);
    const spots: [number, number][] = [];
    for (let y = 0; y + h <= H; y += step) for (let x = 0; x + w <= W; x += step) spots.push([x, y]);
    for (const [x, y] of this.shuffle(spots).slice(0, 600)) {
      const box = { x, y, width: w, height: h };
      if (this.free(box, options.pad)) return box;
    }
    return null;
  }

  /**
   * A page corner whose patch (bleeding off the page by `offset`) is clear of content.
   * Tries the full size first, then shrinks before giving up on a busy layout.
   */
  corner(size: number, pad: number, offset = 0.35): { x: number; y: number; cx: number; cy: number; size: number } | null {
    const { W, H } = this.ctx;
    const corners = this.shuffle([
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
    ]);
    for (const scale of [1, 0.8, 0.62]) {
      const s = size * scale;
      for (const [cx, cy] of corners) {
        const x = cx === 0 ? -s * offset : W - s * (1 - offset);
        const y = cy === 0 ? -s * offset : H - s * (1 - offset);
        if (this.free({ x, y, width: s, height: s }, pad, true)) return { x, y, cx: cx!, cy: cy!, size: s };
      }
    }
    return null;
  }

  claim(box: Box) {
    this.occupied.push(box);
  }

  shuffle<T>(items: T[]) {
    const list = [...items];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list;
  }

  pick<T>(items: T[]) {
    return items[Math.floor(this.rand() * items.length)]!;
  }

  between(min: number, max: number) {
    return min + this.rand() * (max - min);
  }

  /** The surface colour under (x, y): the topmost field or shape beneath the decor layer. */
  surfaceAt(x: number, y: number) {
    for (let i = this.under - 1; i >= 0; i--) {
      const node = this.ctx.nodes[i]!;
      if (node.hidden || node.type === "text" || node.rotation) continue;
      if (x < node.x || y < node.y || x > node.x + node.width || y > node.y + node.height) continue;
      if (node.type === "image") return this.ctx.palette.dark;
      if (node.type !== "shape" || node.shape === "arc" || node.opacity < 0.9) continue;
      if (node.shape === "ellipse") {
        const rx = node.width / 2;
        const ry = node.height / 2;
        if (((x - node.x - rx) / rx) ** 2 + ((y - node.y - ry) / ry) ** 2 > 1) continue;
      }
      if (node.gradient) return mix(solid(node.gradient.from), solid(node.gradient.to), (y - node.y) / node.height);
      if (node.fill !== "transparent") return solid(node.fill);
    }
    return this.ctx.background;
  }

  /** A palette colour that shows on the surface at the box's centre. */
  colour(box: Box, prefer: "accent" | "soft" = "accent") {
    const surface = this.surfaceAt(box.x + box.width / 2, box.y + box.height / 2);
    const P = this.ctx.palette;
    const candidates = prefer === "soft" ? [P.tint, P.accent2, P.accent, P.primary] : [P.accent, P.primary, P.accent2, P.tint];
    const visible = candidates.filter((c) => isHex(c) && c.toLowerCase() !== surface.toLowerCase() && contrast(c, surface) >= 1.35);
    return visible.length ? this.pick(visible.slice(0, 3)) : mix(surface, inkOn(this.ctx, surface), 0.3);
  }
}

function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** rgba(...) or hex → hex (alpha dropped: close enough to choose a contrasting colour). */
function solid(color: string) {
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b] = rgba[1]!.split(",").map((s) => Number(s.trim()));
    return rgbToHex([r!, g!, b!]);
  }
  return isHex(color) ? rgbToHex(hexToRgb(color)) : "#808080";
}

/** Deterministic randomness: the same brief always decorates the same way. */
function random(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Motifs ──────────────────────────────────────────────────────────────────

const SPARKLE = "M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z";
const TRIANGLE = "M50 4L96 92H4Z";
const SQUIGGLE = "M4 50C16 20 28 20 40 50S64 80 76 50S92 30 96 40";

type Painter = (ctx: Ctx, space: Space, amount: number) => void;

/** Scatter `count` pieces of size `size()` into free space; returns how many landed. */
function scatter(space: Space, count: number, size: () => number, place: (box: Box) => void, options: { pad: number; edges?: boolean; near?: Box | null }) {
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const s = size();
    const box = space.find(s, s, options);
    if (!box) continue;
    place(box);
    space.claim(box);
    placed++;
  }
  return placed;
}

const PAINTERS: Record<MotifId, Painter> = {
  confetti(ctx, space, amount) {
    const { u } = ctx;
    scatter(space, Math.round(16 * amount), () => space.between(u * 1.6, u * 3), (box) => {
      const color = space.colour(box);
      const rotation = space.between(-70, 70);
      const kind = space.pick(["strip", "strip", "dot", "triangle", "squiggle"] as const);
      if (kind === "strip") rect(ctx, { x: box.x + box.width * 0.35, y: box.y, width: box.width * 0.32, height: box.height }, color, { rotation, cornerRadius: box.width * 0.12, name: "Confetti" });
      else if (kind === "dot") circle(ctx, box.x + box.width / 2, box.y + box.height / 2, box.width * 0.24, color, { name: "Confetti" });
      else if (kind === "triangle") path(ctx, [TRIANGLE], [100, 100], { x: box.x, y: box.y, width: box.width * 0.7, height: box.height * 0.7 }, { fill: color }, { name: "Confetti", rotation });
      else path(ctx, [SQUIGGLE], [100, 100], box, { stroke: { color, width: 9 } }, { name: "Confetti", rotation });
    }, { pad: u * 1.6, edges: true });
  },

  sparkles(ctx, space, amount) {
    const { u } = ctx;
    const count = Math.round(4 * amount) + 1;
    let first = true;
    const place = (box: Box) => {
      path(ctx, [SPARKLE], [24, 24], box, { fill: space.colour(box) }, { name: "Sparkle" });
      first = false;
    };
    // One hero sparkle, then a few smaller ones: the rhythm a designer would give them.
    const size = () => (first ? space.between(u * 6, u * 8.5) : space.between(u * 2.4, u * 4.4));
    const landed = scatter(space, count, size, place, { pad: u * 1.2, near: space.headline });
    if (landed < count) scatter(space, count - landed, size, place, { pad: u * 1.2, edges: true });
  },

  stars(ctx, space, amount) {
    const { u } = ctx;
    scatter(space, Math.round(7 * amount), () => space.between(u * 1.8, u * 3.8), (box) => {
      const color = space.colour(box);
      path(ctx, ICONS.star, [24, 24], box, { fill: color, stroke: { color, width: 1 } }, { name: "Star", rotation: space.between(-25, 25) });
    }, { pad: u * 1.4, edges: true });
  },

  bokeh(ctx, space, amount) {
    const { u } = ctx;
    // Bokeh is light in the dark: on a pale surface a translucent disc reads as a stain, so skip it there.
    scatter(space, Math.round(6 * amount), () => space.between(u * 6, u * 18), (box) => {
      const surface = space.surfaceAt(box.x + box.width / 2, box.y + box.height / 2);
      if (!isDark(surface)) return;
      const glow = [ctx.palette.accent, ctx.palette.primary, ctx.palette.accent2].filter((c) => isHex(c) && contrast(c, surface) >= 2);
      circle(ctx, box.x + box.width / 2, box.y + box.height / 2, box.width / 2, glow.length ? space.pick(glow) : "#FFFFFF", { opacity: space.between(0.14, 0.28), name: "Glow" });
    }, { pad: u * 0.8 });
  },

  rings(ctx, space) {
    const { m, u } = ctx;
    const wanted = m * space.between(3.6, 5);
    const spot = space.corner(wanted, u * 2, 0.5);
    if (!spot) return;
    const size = spot.size;
    const cx = spot.x + size / 2;
    const cy = spot.y + size / 2;
    // Colour from the visible quarter (the centre sits on the page corner).
    const probe = { x: Math.min(Math.max(cx, u), ctx.W - u * 3), y: Math.min(Math.max(cy, u), ctx.H - u * 3), width: u * 2, height: u * 2 };
    const color = space.colour(probe);
    for (let i = 0; i < 4; i++) ring(ctx, cx, cy, (size / 2) * (1 - i * 0.2), Math.max(2, u * 0.35), color, 0, 360, 0.8 - i * 0.14);
    space.claim({ x: spot.x, y: spot.y, width: size, height: size });
  },

  dots(ctx, space, amount) {
    const { u } = ctx;
    const patches = amount > 1 ? 2 : 1;
    for (let i = 0; i < patches; i++) {
      const cols = Math.round(space.between(5, 8));
      const rows = Math.round(space.between(3, 5));
      const gap = u * 2.2;
      const box = space.find((cols - 1) * gap + u, (rows - 1) * gap + u, { pad: u * 2, edges: true });
      if (!box) continue;
      dotGrid(ctx, box.x, box.y, cols, rows, gap, u * 0.42, space.colour(box), 0.85);
      space.claim(box);
    }
  },

  halftone(ctx, space) {
    const { m, u } = ctx;
    const wanted = m * space.between(3.2, 4.2);
    const spot = space.corner(wanted, u * 2, 0.15);
    if (!spot) return;
    const size = spot.size;
    const cells = 11;
    const gap = size / cells;
    let d = "";
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        // Dots swell towards the page corner.
        const fx = spot.cx === 0 ? 1 - col / (cells - 1) : col / (cells - 1);
        const fy = spot.cy === 0 ? 1 - row / (cells - 1) : row / (cells - 1);
        const r = gap * 0.46 * Math.max(0.12, (fx + fy) / 2) ** 1.4;
        const x = (col + 0.5) * gap;
        const y = (row + 0.5) * gap;
        d += `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(r * 2).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-r * 2).toFixed(1)} 0`;
      }
    }
    const box = { x: spot.x, y: spot.y, width: size, height: size };
    path(ctx, [d], [size, size], box, { fill: space.colour(box) }, { name: "Halftone", opacity: 0.9 });
    space.claim(box);
  },

  stripes(ctx, space) {
    const { m, u } = ctx;
    const wanted = m * space.between(2.8, 3.6);
    const spot = space.corner(wanted, u * 2, 0.08);
    if (!spot) return;
    const size = spot.size;
    // Diagonal bands filling the corner's triangle, as on hazard tape or a sale tag.
    const n = 7;
    const step = 100 / n;
    let d = "";
    for (let i = 0; i < n; i += 1) {
      const a = i * step;
      const b = a + step * 0.5;
      d += `M${a.toFixed(1)} 0L${b.toFixed(1)} 0L0 ${b.toFixed(1)}L0 ${a.toFixed(1)}Z`;
    }
    const flipX = spot.cx !== 0;
    const flipY = spot.cy !== 0;
    const rotation = flipX && flipY ? 180 : flipX ? 90 : flipY ? -90 : 0;
    const box = { x: spot.x, y: spot.y, width: size, height: size };
    // Rotate about the box centre: Konva rotates about x/y, so shift the origin to match.
    const t = (rotation * Math.PI) / 180;
    const cx = size / 2;
    const ox = spot.x + cx - (cx * Math.cos(t) - cx * Math.sin(t));
    const oy = spot.y + cx - (cx * Math.sin(t) + cx * Math.cos(t));
    path(ctx, [d], [100, 100], { x: ox, y: oy, width: size, height: size }, { fill: space.colour(box) }, { name: "Stripes", rotation });
    space.claim(box);
  },

  waves(ctx, space) {
    const { W, u } = ctx;
    const width = W * space.between(0.26, 0.36);
    const height = u * 7;
    const box = space.find(width, height, { pad: u * 2, edges: true, tries: 60 });
    if (!box) return;
    const amplitude = 12;
    const lines = [20, 50, 80].map((y) => {
      let d = `M0 ${y}`;
      for (let x = 0; x < 300; x += 50) d += `Q${x + 25} ${y - amplitude} ${x + 50} ${y}T${x + 100} ${y}`;
      return d;
    });
    path(ctx, [lines.join("")], [400, 100], box, { stroke: { color: space.colour(box), width: 6 } }, { name: "Waves" });
    space.claim(box);
  },

  leaves(ctx, space, amount) {
    const { u } = ctx;
    scatter(space, Math.round(6 * amount), () => space.between(u * 2.8, u * 5.5), (box) => {
      path(ctx, ICONS.leaf, [24, 24], box, { stroke: { color: space.colour(box), width: 1.8 } }, { name: "Leaf", rotation: space.between(-60, 60) });
    }, { pad: u * 1.4, edges: true });
  },

  plus(ctx, space, amount) {
    const { u } = ctx;
    scatter(space, Math.round(8 * amount), () => space.between(u * 1.4, u * 2.6), (box) => {
      path(ctx, ["M12 3V21M3 12H21"], [24, 24], box, { stroke: { color: space.colour(box), width: 4 } }, { name: "Plus" });
    }, { pad: u * 1.4, edges: true });
  },

  blobs(ctx, space, amount) {
    const { m, u } = ctx;
    for (let i = 0; i < (amount > 1 ? 2 : 1); i++) {
      const wanted = m * space.between(3, 4.6);
      const spot = space.corner(wanted, u * 2, 0.45);
      if (!spot) return;
      const size = spot.size;
      const box = { x: spot.x, y: spot.y, width: size, height: size };
      path(ctx, [blob(space)], [100, 100], box, { fill: space.colour(box, "soft") }, { name: "Blob", opacity: 0.55 });
      space.claim(box);
    }
  },

  frame(ctx, space) {
    const { W, H, m, u } = ctx;
    const inset = m * 0.42;
    const line = Math.max(2, u * 0.22);
    // Only when every word sits inside the frame.
    const band = (box: Box) => space.occupied.some((o) => overlaps(box, o, u));
    const edges = [
      { x: inset, y: inset, width: W - inset * 2, height: line },
      { x: inset, y: H - inset - line, width: W - inset * 2, height: line },
      { x: inset, y: inset, width: line, height: H - inset * 2 },
      { x: W - inset - line, y: inset, width: line, height: H - inset * 2 },
    ];
    if (edges.some(band)) return;
    const color = space.colour({ x: inset, y: inset, width: u, height: u });
    rect(ctx, { x: inset, y: inset, width: W - inset * 2, height: H - inset * 2 }, "transparent", { stroke: { color, width: line }, name: "Frame" });
    // Small diamonds on the corners, as on an invitation.
    const d = u * 1.6;
    for (const [x, y] of [
      [inset, inset],
      [W - inset, inset],
      [inset, H - inset],
      [W - inset, H - inset],
    ]) {
      path(ctx, ["M12 0L24 12L12 24L0 12Z"], [24, 24], { x: x! - d / 2, y: y! - d / 2, width: d, height: d }, { fill: color }, { name: "Frame ornament" });
    }
  },

  grid(ctx, space) {
    const { W, H, u } = ctx;
    const cell = u * 6;
    const width = Math.round((W * space.between(0.28, 0.4)) / cell) * cell;
    const height = Math.round((H * space.between(0.14, 0.22)) / cell) * cell;
    const box = space.find(width, height, { pad: u * 2, edges: true, tries: 60 });
    if (!box) return;
    let d = "";
    for (let x = 0; x <= width + 0.5; x += cell) d += `M${x.toFixed(1)} 0V${height}`;
    for (let y = 0; y <= height + 0.5; y += cell) d += `M0 ${y.toFixed(1)}H${width}`;
    path(ctx, [d], [width, height], box, { stroke: { color: space.colour(box), width: Math.max(1.5, u * 0.15) } }, { name: "Grid", opacity: 0.55 });
    space.claim(box);
  },
};

/** A smooth organic closed curve (Catmull-Rom through jittered radii). */
function blob(space: Space) {
  const n = 7;
  const points = Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2;
    const r = 34 + space.rand() * 14;
    return [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)] as const;
  });
  let d = `M${points[0]![0].toFixed(1)} ${points[0]![1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0]!.toFixed(1)} ${c1[1]!.toFixed(1)} ${c2[0]!.toFixed(1)} ${c2[1]!.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}
