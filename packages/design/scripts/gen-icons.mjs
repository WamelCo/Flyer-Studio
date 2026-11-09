/**
 * Regenerates lib/design/icons.json: a curated lucide icon set flattened to SVG path data
 * list per icon (24×24 viewBox, stroke-only), so icons are editable canvas vectors.
 * Each element stays its own subpath: lucide paths often start with a relative `m`,
 * which would shift if concatenated into one path.
 *
 *   node scripts/gen-icons.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ICONS_DIR = join(import.meta.dirname, "..", "..", "..", "apps", "web", "node_modules", "lucide-react", "dist", "esm", "icons");
const OUT = join(import.meta.dirname, "..", "src", "icons.json");

// name in our app → lucide file name
const ICONS = {
  phone: "phone", mail: "mail", globe: "globe", "map-pin": "map-pin", calendar: "calendar", clock: "clock",
  ticket: "ticket", headphones: "headphones", guitar: "guitar", mic: "mic", star: "star", check: "check", "check-circle": "circle-check",
  lightbulb: "lightbulb", search: "search", "bar-chart": "chart-column", "trending-up": "trending-up",
  dollar: "dollar-sign", shield: "shield-check", heart: "heart", "heart-pulse": "heart-pulse",
  stethoscope: "stethoscope", "graduation-cap": "graduation-cap", "book-open": "book-open", briefcase: "briefcase",
  users: "users", user: "user", home: "house", bed: "bed-double", bath: "bath", ruler: "ruler", key: "key-round",
  tag: "tag", percent: "percent", "shopping-bag": "shopping-bag", gift: "gift", party: "party-popper",
  utensils: "utensils", coffee: "coffee", wine: "wine", leaf: "leaf", sun: "sun", snowflake: "snowflake",
  sparkles: "sparkles", rocket: "rocket", award: "award", target: "target", zap: "zap", camera: "camera",
  palette: "palette", dumbbell: "dumbbell", car: "car", plane: "plane", "arrow-right": "arrow-right",
  "at-sign": "at-sign", share: "share-2", handshake: "handshake", baby: "baby",
  paw: "paw-print", cross: "cross", church: "church", trophy: "trophy", wrench: "wrench", laptop: "laptop",
};

function toPath(tag, a) {
  const n = (v) => Number(v ?? 0);
  switch (tag) {
    case "path":
      return a.d;
    case "circle": {
      const [cx, cy, r] = [n(a.cx), n(a.cy), n(a.r)];
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
    case "ellipse": {
      const [cx, cy, rx, ry] = [n(a.cx), n(a.cy), n(a.rx), n(a.ry)];
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
    }
    case "line":
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case "polyline":
    case "polygon": {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return tag === "polygon" ? `${d}Z` : d;
    }
    case "rect": {
      const [x, y, w, h] = [n(a.x), n(a.y), n(a.width), n(a.height)];
      const r = Math.min(n(a.rx ?? a.ry), w / 2, h / 2);
      if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
    }
    default:
      throw new Error(`unsupported element ${tag}`);
  }
}

const out = {};
const missing = [];
for (const [name, file] of Object.entries(ICONS)) {
  let source;
  try {
    source = readFileSync(join(ICONS_DIR, `${file}.mjs`), "utf8");
  } catch {
    missing.push(name);
    continue;
  }
  const match = source.match(/const __iconData = (\{[\s\S]*?\n\});/);
  if (!match) {
    missing.push(name);
    continue;
  }
  // The icon literal is plain data (arrays/objects of strings).
  const { node } = Function(`"use strict"; return (${match[1]});`)();
  out[name] = node.map(([tag, attrs]) => toPath(tag, attrs));
}

writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log(`wrote ${Object.keys(out).length} icons to ${OUT}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`);
