import type { FlyerDoc, FlyerFormat } from "@/lib/canvas/types";
import { ARCHETYPE_IDS, ARCHETYPES, type ArchetypeId } from "@/lib/design/archetypes";
import { decorate, type Decor } from "@/lib/design/decor";
import { createCtx, type DesignCopy, type StockPhoto } from "@/lib/design/engine";
import { PALETTES, withBrandColor, type PaletteId } from "@/lib/design/palettes";
import { PAIRINGS, type PairingId } from "@/lib/design/typography";

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
export function chooseVariants(
  ranked: { layouts: ArchetypeId[]; palettes: PaletteId[]; pairings: PairingId[] },
  { count = 3, hasPhotos = true, richCopy = true }: { count?: number; hasPhotos?: boolean; richCopy?: boolean } = {},
): Variant[] {
  // Without photography, photo-led layouts would ship empty frames; with a one-line
  // message, sectioned layouts would ship empty sections. Use layouts that suit both.
  const usable = (id: ArchetypeId) => (hasPhotos || !ARCHETYPES[id].needsPhotos) && (richCopy || !ARCHETYPES[id].needsContent);
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
}

export function composeDesign({ format, copy, variant, photos, decor, brandColor }: ComposeInput): FlyerDoc {
  const archetype = ARCHETYPES[variant.archetype];
  const ctx = createCtx({
    format,
    palette: withBrandColor(PALETTES[variant.palette], brandColor),
    type: PAIRINGS[variant.pairing],
    copy,
    photos: archetype.photos === 0 ? [] : photos,
    motifs: decor?.motifs ?? [],
  });
  archetype.render(ctx);
  // Seeded by the content, so the same brief always decorates the same way.
  if (decor) decorate(ctx, decor, `${copy.headline}|${variant.archetype}|${variant.palette}|${format}`);
  return { version: 1, format, width: ctx.W, height: ctx.H, background: ctx.background, nodes: ctx.nodes };
}
