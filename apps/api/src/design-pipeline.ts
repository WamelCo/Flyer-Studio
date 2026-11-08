import type { FlyerDoc, FlyerFormat } from "@flyer/core/canvas/types";
import { decorForVariant, rankedChoices, toDesignCopy, type DesignBrief } from "@flyer/core/design/brief";
import { chooseVariants, composeDesign, hasRichCopy, type Variant } from "@flyer/core/design/compose";
import { directDesign } from "@flyer/core/design/director";
import type { StockPhoto } from "@flyer/core/design/engine";
import { PALETTES, withBrandColor } from "@flyer/core/design/palettes";
import { photosForBrief } from "@flyer/core/design/photos";
import type { RenderMeta } from "@flyer/core/design/render-prompt";
import { PAIRINGS } from "@flyer/core/design/typography";

import { renderingEnabled, withoutPlaceholderPhotos } from "./render";

export const VARIATIONS = 3;

/** Frames for the renderer to paint when no stock photo was found (never shipped as-is). */
const placeholderPhotos = (count: number): StockPhoto[] =>
  Array.from({ length: count }, (_, i) => ({ url: `render://photo/${i}`, width: 1600, height: 1200, credit: { name: "", url: "" } }));

/**
 * Prompt → art direction (LLM) → stock photos (Unsplash) → three engine-composed designs.
 * Nothing is rendered here: the user picks a design and only that one is rendered
 * (POST /api/generate/:jobId/render). Pure of database and billing, so the route and
 * scripts/try-generate.mts run the same code.
 */
export async function designFlyers(prompt: string, format: FlyerFormat) {
  const { brief, source, model } = await directDesign(prompt, format);
  const copy = toDesignCopy(brief);
  const choices = rankedChoices(brief);
  const rendering = renderingEnabled();
  const photoSets = await photosForBrief(brief.photoQueries, format, VARIATIONS);
  // With a renderer, photo layouts don't depend on stock search: it paints the frames.
  const layoutPhotos = photoSets.map((set) => (rendering && set.length === 0 ? placeholderPhotos(4) : set));
  const variants = chooseVariants(choices, {
    count: VARIATIONS,
    hasPhotos: layoutPhotos.every((set) => set.length > 0),
    richCopy: hasRichCopy(copy),
  });

  // The engine designs every variant: grid, spacing, hierarchy, palette, type, contrast.
  // `designs` keep their paintable frames for the renderer; `docs` are what the user edits.
  const designs: FlyerDoc[] = variants.map((variant, i) =>
    composeDesign({
      format,
      copy,
      variant,
      photos: layoutPhotos[i] ?? [],
      decor: decorForVariant(choices.decor, i),
      brandColor: choices.brandColor,
    }),
  );
  const docs = designs.map(withoutPlaceholderPhotos);

  return { brief, source, model, copy, variants, designs, docs, photoSets, renderable: rendering };
}

/** The renderer's brief for one variant, rebuilt from what the job stored. */
export function renderMeta(brief: DesignBrief, variant: Variant): RenderMeta {
  return {
    archetype: variant.archetype,
    palette: withBrandColor(PALETTES[variant.palette], rankedChoices(brief).brandColor),
    pairing: PAIRINGS[variant.pairing],
    subject: `${brief.category.replace("_", " ")} flyer for ${brief.audience}`,
    tone: brief.tone,
    photoPrompts: brief.photoQueries,
  };
}
