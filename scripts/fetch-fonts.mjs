/**
 * Downloads the flyer typefaces as TTF (Latin subset) for server-side rendering
 * (lib/render/). Same families and weights as lib/design/metrics.json, plus the italics
 * the type pairings use. All are SIL Open Font License; see assets/fonts/OFL.md.
 *   node scripts/fetch-fonts.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = join(root, "assets", "fonts");
mkdirSync(out, { recursive: true });
const metrics = JSON.parse((await import("node:fs")).readFileSync(join(root, "lib/design/metrics.json"), "utf8"));

/** FontKey → Fontsource id and the family name inside the font file. */
export const FAMILIES = {
  sans: ["inter", "Inter"],
  geometric: ["montserrat", "Montserrat"],
  serif: ["playfair-display", "Playfair Display"],
  elegant: ["cormorant-garamond", "Cormorant Garamond"],
  dserif: ["dm-serif-display", "DM Serif Display"],
  display: ["bebas-neue", "Bebas Neue"],
  heavy: ["anton", "Anton"],
  condensed: ["oswald", "Oswald"],
  grotesk: ["space-grotesk", "Space Grotesk"],
  calligraphy: ["great-vibes", "Great Vibes"],
  script: ["caveat", "Caveat"],
};
const ITALIC = { serif: ["400", "700"], elegant: ["400", "500", "600"] };

let files = 0;
let bytes = 0;
for (const [key, [id]] of Object.entries(FAMILIES)) {
  const weights = Object.keys(metrics.fonts[key]).filter((k) => /^\d+$/.test(k));
  const wanted = [...weights.map((w) => [w, "normal"]), ...(ITALIC[key] ?? []).map((w) => [w, "italic"])];
  for (const [weight, style] of wanted) {
    const url = `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${weight}-${style}.ttf`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`  skip ${key} ${weight} ${style}: HTTP ${response.status}`);
      continue;
    }
    const data = Buffer.from(await response.arrayBuffer());
    writeFileSync(join(out, `${key}-${weight}${style === "italic" ? "-italic" : ""}.ttf`), data);
    files++;
    bytes += data.length;
  }
}
writeFileSync(join(out, "families.json"), JSON.stringify(Object.fromEntries(Object.entries(FAMILIES).map(([key, [, name]]) => [key, name])), null, 2) + "\n");
console.log(`${files} font files, ${(bytes / 1024 / 1024).toFixed(1)} MB → assets/fonts`);
