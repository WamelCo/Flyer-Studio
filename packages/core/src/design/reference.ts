import { ARCHETYPE_IDS, type ArchetypeId } from "./archetypes";
import { hexToRgb, isHex, luminance, normalizeHex } from "./color";
import { PALETTE_IDS, PALETTES, type PaletteId } from "./palettes";

/**
 * A reference image's visual style, applied to a new flyer: its colours (measured from
 * the pixels) and its look (Ideogram's description). Only style transfers — never its
 * content: no people, products, names or words from the reference reach the new flyer.
 */
export interface ReferenceStyle {
  aesthetics?: string;
  artStyle?: string;
  medium?: string;
  /** Dominant colours, most prominent first. */
  palette: string[];
  /** The strongest saturated colour: becomes the engine palette's primary. */
  brandColor: string | null;
  /** A second, clearly different saturated colour: becomes the accent. */
  accentColor: string | null;
  /** Whether the reference is a light page with colour accents or a dark/colour-filled one. */
  tone: "light" | "dark" | null;
  /** Our layouts closest to the reference's structure, best first. */
  layouts: ArchetypeId[];
}

/** A measured colour and its share of the image (0–1). */
export interface ColorShare {
  hex: string;
  share: number;
}

function hsl(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  let h = 0;
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, l };
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Brand and accent from measured colours: prominent, saturated, mid-light, distinct hues. */
export function brandPair(colors: ColorShare[]): { brandColor: string | null; accentColor: string | null } {
  const vivid = colors
    .map((c) => ({ ...c, ...hsl(c.hex) }))
    .filter((c) => c.s > 0.28 && c.l > 0.14 && c.l < 0.86 && c.share > 0.004)
    // Prominence weighted by saturation: a small vivid accent beats a big dull tint.
    .sort((a, b) => b.share * (0.4 + b.s) - a.share * (0.4 + a.s));
  const brand = vivid[0];
  const accent = brand ? vivid.find((c) => hueGap(c.h, brand.h) > 35) : undefined;
  return { brandColor: brand?.hex ?? null, accentColor: accent?.hex ?? null };
}

/** Structure words in a reference's description → our closest archetypes. */
const LAYOUT_CUES: [RegExp, ArchetypeId][] = [
  [/\b(collage|several photos|multiple photos|photo grid|fan of photos|three photos|framed photos)\b/i, "bold-stack"],
  [/\b(circular|circle|ring)\b[^.]*\b(behind|around|framing)\b|\b(portrait|arms crossed)\b/i, "editorial-split"],
  [/\b(full-bleed|full bleed|background photo|photograph (?:fills|covers)|over a photo|photographic background)\b/i, "photo-overlay"],
  [/\b(overlapping circles|geometric shapes|quarter circles|split (?:layout|design))\b/i, "geometric-split"],
  [/\b(minimal(?:ist)? typograph|text-only|typographic|large bold text)\b/i, "swiss-type"],
];

export function referenceStyleFrom(
  description: {
    high_level_description?: string;
    style_description?: { aesthetics?: string; art_style?: string; medium?: string };
    compositional_deconstruction?: { background?: string; elements?: { desc?: string }[] };
  } | null,
  colors: ColorShare[],
): ReferenceStyle {
  const style = description?.style_description ?? {};
  const scene = description?.compositional_deconstruction;
  const words = [description?.high_level_description, scene?.background, ...(scene?.elements ?? []).map((e) => e.desc), style.aesthetics, style.art_style].filter(Boolean).join(" ");
  const layouts = [...new Set(LAYOUT_CUES.filter(([cue]) => cue.test(words)).map(([, id]) => id))];
  // The page's tone: what most of the reference is made of.
  const main = colors[0];
  const described = /\b(white|light|cream|pale) background\b/i.test(words) ? "light" : /\b(dark|black|navy) background\b/i.test(words) ? "dark" : null;
  const measured = main ? (luminance(main.hex) > 0.6 ? "light" : luminance(main.hex) < 0.2 ? "dark" : null) : null;
  const clean = (text?: string) => text?.replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
  return {
    aesthetics: clean(style.aesthetics),
    artStyle: clean(style.art_style),
    medium: clean(style.medium),
    palette: colors.map((c) => c.hex).filter((hex) => isHex(hex)).map(normalizeHex).slice(0, 8),
    ...brandPair(colors),
    tone: described ?? measured,
    layouts,
  };
}

/**
 * Re-ranks the director's choices toward a reference: its layout structure first, palettes
 * whose page tone matches (a white reference gets a light page with its colours as accents,
 * not a colour-filled one), and the Swiss layout — always a solid colour field — last for
 * light references unless the reference itself is typographic.
 */
export function followReference<T extends { layouts: ArchetypeId[]; palettes: PaletteId[] }>(ranked: T, reference: ReferenceStyle | null | undefined): T {
  if (!reference) return ranked;
  let layouts = [...new Set([...reference.layouts, ...ranked.layouts])];
  // Every other layout before Swiss: chooseVariants may filter the reference's own
  // layouts out (thin copy), and Swiss must not inherit the lead.
  if (reference.tone === "light" && !reference.layouts.includes("swiss-type")) layouts = [...[...new Set([...layouts, ...ARCHETYPE_IDS])].filter((id) => id !== "swiss-type"), "swiss-type"];
  const matches = (id: PaletteId) => !reference.tone || (luminance(PALETTES[id].bg) > 0.5) === (reference.tone === "light");
  const pool = [...new Set([...ranked.palettes, ...PALETTE_IDS])];
  const palettes = [...pool.filter(matches), ...pool.filter((id) => !matches(id))].slice(0, Math.max(ranked.palettes.length, 3));
  return { ...ranked, layouts, palettes };
}
