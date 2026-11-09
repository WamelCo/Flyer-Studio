import type { FlyerDoc, FlyerFormat } from "./canvas/types";
import { ARCHETYPE_IDS, ARCHETYPES, type ArchetypeId } from "./archetypes";
import { DECOR_LEVELS, decorate, type Decor } from "./decor";
import { createCtx, type DesignCopy, type StockPhoto } from "./engine";
import { PALETTES, withBrandColor, type PaletteId } from "./palettes";
import { PAIRINGS, type PairingId } from "./typography";

export interface Variant {
  archetype: ArchetypeId;
  palette: PaletteId;
  pairing: PairingId;
}

/** Enough copy to fill a sectioned layout: a body paragraph, features or a list. */
export function hasRichCopy(copy: DesignCopy) {
  return Boolean(copy.body) || copy.features.length > 0 || copy.bullets.length > 1;
}

/**
 * Three design directions from the art director's ranked choices — each a different
 * layout where possible, so the variations explore rather than repeat.
 */
/**
 * Whether a layout suits what we have. Without photography, photo-led layouts would ship
 * empty frames; with a one-line message, sectioned layouts would ship empty sections; and
 * some layouts need something specific in the copy (a big-number layout needs a figure).
 */
export function layoutSuits(id: ArchetypeId, { hasPhotos, richCopy, copy }: { hasPhotos: boolean; richCopy: boolean; copy?: DesignCopy }) {
  const layout = ARCHETYPES[id];
  return (hasPhotos || !layout.needsPhotos) && (richCopy || !layout.needsContent) && (!copy || !layout.fits || layout.fits(copy));
}

export function chooseVariants(
  ranked: { layouts: ArchetypeId[]; palettes: PaletteId[]; pairings: PairingId[] },
  { count = 3, hasPhotos = true, richCopy = true, copy }: { count?: number; hasPhotos?: boolean; richCopy?: boolean; copy?: DesignCopy } = {},
): Variant[] {
  const usable = (id: ArchetypeId) => layoutSuits(id, { hasPhotos, richCopy, copy });
  const layouts = [...new Set([...ranked.layouts.filter(usable), ...ARCHETYPE_IDS.filter(usable)])];
  const palettes = [...new Set(ranked.palettes)];
  const pairings = [...new Set(ranked.pairings)];
  return Array.from({ length: count }, (_, i) => ({
    archetype: layouts[i % layouts.length]!,
    palette: palettes[i % palettes.length]!,
    pairing: pairings[i % pairings.length]!,
  }));
}

interface ComposeInput {
  format: FlyerFormat;
  copy: DesignCopy;
  variant: Variant;
  photos: StockPhoto[];
  /** Decorative motifs placed in the layout's free space, behind the type. */
  decor?: Decor;
  brandColor?: string | null;
  /** A second colour the user asked for. */
  accentColor?: string | null;
}

export function composeDesign({ format, copy, variant, photos, decor, brandColor, accentColor }: ComposeInput): FlyerDoc {
  const archetype = ARCHETYPES[variant.archetype];
  const ctx = createCtx({
    format,
    palette: withBrandColor(PALETTES[variant.palette], brandColor, accentColor),
    type: PAIRINGS[variant.pairing],
    copy,
    photos: archetype.photos === 0 ? [] : photos,
    motifs: decor?.motifs ?? [],
  });
  archetype.render(ctx);
  // Seeded by the content, so the same brief always decorates the same way. Quiet layouts
  // cap the level whatever the brief asked for.
  if (decor && archetype.maxDecor !== "none") {
    const cap = archetype.maxDecor ? DECOR_LEVELS.indexOf(archetype.maxDecor) : DECOR_LEVELS.length - 1;
    const level = DECOR_LEVELS[Math.min(DECOR_LEVELS.indexOf(decor.level), cap)]!;
    decorate(ctx, { ...decor, level }, `${copy.headline}|${variant.archetype}|${variant.palette}|${format}`);
  }
  return { version: 1, format, width: ctx.W, height: ctx.H, background: ctx.background, nodes: ctx.nodes };
}
