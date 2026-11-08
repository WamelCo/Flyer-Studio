import { notFound } from "next/navigation";

import { FIXTURES } from "@/app/dev-playground/fixtures";
import { FORMAT_ORDER } from "@flyer/core/canvas/formats";
import { decorForVariant, rankedChoices, rulesBrief, toDesignCopy, type DesignBrief } from "@flyer/core/design/brief";
import { chooseVariants, composeDesign, hasRichCopy } from "@flyer/core/design/compose";
import { DECOR_LEVELS, type DecorLevel } from "@flyer/core/design/decor";
import { directDesign } from "@flyer/core/design/director";
import { photosForBrief } from "@flyer/core/design/photos";

import { GalleryLoader } from "./loader";

const PROMPTS = [
  "Summer jazz night at the Blue Room, Friday 8pm, tickets $15",
  "50% off everything this weekend at Juniper & Co.",
  "Open house Sunday 1–4pm, 3 bed modern home on Maple Street",
  "Kids birthday party for Mia turning 6, Saturday 2pm",
];

// TEMPORARY design-review gallery.
//   ?only=N        one reference brief in every format (add &decor=bold to see the motifs)
//   ?mode=rules    real prompts through the rules fallback, no photos
//   ?mode=live     the same prompts with real Unsplash photos, as /api/generate builds them
//   ?mode=ai       the configured art director (open model / Claude) + photos — one model call per prompt
//   &decor=off     compare without decoration;  &prompt=N  just one prompt
export default async function GalleryPage({ searchParams }: PageProps<"/dev-playground/gallery">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { only, mode, prompt: one, decor } = await searchParams;
  const decorOff = decor === "off";
  const prompts = typeof one === "string" ? [PROMPTS[Number(one)] ?? PROMPTS[0]!] : PROMPTS;

  if (mode === "rules" || mode === "live" || mode === "ai") {
    const groups = await Promise.all(
      prompts.map(async (prompt) => {
        const direction = mode === "ai" ? await directDesign(prompt, "poster") : { brief: rulesBrief(prompt), model: "built-in rules" };
        return designs(direction.brief, prompt, direction.model, mode !== "rules", decorOff);
      }),
    );
    return <GalleryLoader items={groups.flat()} columns={3} />;
  }

  const level = DECOR_LEVELS.includes(decor as DecorLevel) ? (decor as DecorLevel) : null;
  const fixtures = typeof only === "string" ? FIXTURES.filter((_, i) => String(i) === only) : FIXTURES;
  const items = fixtures.flatMap((fixture) =>
    FORMAT_ORDER.map((format) => ({
      label: `${fixture.name} · ${format}`,
      doc: composeDesign({
        format,
        copy: fixture.copy,
        variant: fixture.variant,
        photos: fixture.photos,
        decor: level ? { level, motifs: ["sparkles", "dots", "rings"] } : undefined,
      }),
    })),
  );
  return <GalleryLoader items={items} />;
}

async function designs(brief: DesignBrief, prompt: string, model: string, withPhotos: boolean, decorOff: boolean) {
  const copy = toDesignCopy(brief);
  const choices = rankedChoices(brief);
  const photoSets = withPhotos ? await photosForBrief(brief.photoQueries, "poster", 3) : [[], [], []];
  const variants = chooseVariants(choices, { hasPhotos: photoSets.every((set) => set.length > 0), richCopy: hasRichCopy(copy) });
  return variants.map((variant, i) => {
    const decor = decorForVariant(choices.decor, i);
    return {
      label: `${prompt.slice(0, 22)}… · ${variant.archetype} / ${variant.palette} · ${decorOff ? "no decor" : `${decor.level}: ${decor.motifs.slice(0, 2).join("+")}`} · ${model}`,
      doc: composeDesign({ format: "poster", copy, variant, photos: photoSets[i] ?? [], decor: decorOff ? undefined : decor, brandColor: choices.brandColor }),
    };
  });
}
