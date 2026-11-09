import type { FlyerFormat } from "@flyer/design/canvas/types";
import { ARCHETYPES } from "@flyer/design/archetypes";
import { decorForVariant, rankedChoices, storedIntent, toDesignCopy } from "./brief";
import { chooseVariants, composeDesign, hasRichCopy } from "@flyer/design/compose";
import { directDesign } from "./director";
import { ideogramConfigured, ideogramDirection } from "./ideogram";
import { PALETTES, withBrandColor } from "@flyer/design/palettes";
import { photosForBrief, placedPhotos, trackDownloads } from "@flyer/design/photos";
import { reviewAndRefine, type Slot } from "./refine";
import { PAIRINGS } from "@flyer/design/typography";
import { db, flyerProjects } from "@flyer/db";
import type { FlyerDoc } from "@flyer/design/canvas/types";

import { ideogramAllowed } from "./limits";

export const VARIATIONS = 3;

/** Where a job is, in the order it happens. The client shows a sentence for each. */
export const STAGES = ["queued", "directing", "designing", "composing", "reviewing", "saving"] as const;
export type Stage = (typeof STAGES)[number];

export type Channel = "web" | "whatsapp";

export interface GenerationInput {
  jobId: string;
  userId: string;
  prompt: string;
  format: FlyerFormat;
  cost: number;
  channel?: Channel;
  /** false keeps the lead off Ideogram (free flyers never buy a paid image). */
  ideogram?: boolean;
  /** Paid with a free flyer: given back if the job fails. */
  freeFlyer?: boolean;
}

/** What a finished generation hands the client (the web app adds the balance). */
export interface DesignResult {
  jobId: string;
  projectId: string;
  format: FlyerFormat;
  /** Three composed, editable designs — one per design direction. */
  docs: FlyerDoc[];
  /** Strongest first; `score` is the creative-director review (1–10) when one ran. */
  directions: { layout: string; palette: string; type: string; score?: number }[];
  /** The art director’s reasoning (colour psychology, type voice, layout). */
  rationale: string;
  /** Who art-directed: Claude, an open-weight model (open-model.ts) or the built-in rules. */
  source: "claude" | "open-model" | "rules";
  /** Unsplash download-tracking URLs for the photos placed in each design. */
  photoDownloads: string[][];
}

/** What the finished job records on its row (besides status and result). */
export interface JobRecord {
  intent: string;
  projectId: string;
  variations: unknown;
}

/**
 * Prompt → art direction (Qwen / Claude, fact-checked) → three directions: the lead one
 * designed by Ideogram with its text lifted into editable layers (when configured and
 * under the spend cap), the others composed by the layout engine with stock photos.
 * Persists the first design as the project and returns all three.
 */
export async function designFlyer(input: GenerationInput, onStage: (stage: Stage) => Promise<void>): Promise<{ response: DesignResult; record: JobRecord }> {
  const { jobId, userId, prompt, format } = input;

  await onStage("directing");
  const { brief, source, model } = await directDesign(prompt, format);
  const copy = toDesignCopy(brief);
  const choices = rankedChoices(brief);
  const colours = { brandColor: choices.brandColor, accentColor: choices.accentColor };

  await onStage("designing");
  // The Ideogram lead and the stock-photo search don't depend on each other.
  const useIdeogram = input.ideogram !== false && ideogramConfigured() && (await ideogramAllowed(userId));
  const [photoSets, lead] = await Promise.all([
    photosForBrief(brief.photoQueries, format, VARIATIONS),
    useIdeogram
      ? ideogramDirection({
          brief,
          copy,
          format,
          palette: withBrandColor(PALETTES[choices.palettes[0]!], colours.brandColor, colours.accentColor),
          pairing: PAIRINGS[choices.pairings[0]!],
          userId,
          jobId,
        })
      : Promise.resolve(null),
  ]);

  await onStage("composing");
  const ranked = chooseVariants(choices, { count: VARIATIONS, hasPhotos: photoSets.every((set) => set.length > 0), richCopy: hasRichCopy(copy), copy });
  // With an Ideogram lead (first palette and pairing), the engine designs the other two
  // directions in the second and third, keeping its best layouts.
  const variants = lead ? ranked.slice(0, 2).map((v, i) => ({ ...v, palette: ranked[i + 1]!.palette, pairing: ranked[i + 1]!.pairing })) : ranked;
  const offset = lead ? 1 : 0;
  const richCopy = hasRichCopy(copy);
  const slots: Slot[] = [
    ...(lead
      ? [{ doc: lead.doc, variant: null, photos: [], decor: decorForVariant(choices.decor, 0), copy, label: { layout: "Ideogram design", palette: PALETTES[choices.palettes[0]!].name, type: PAIRINGS[choices.pairings[0]!].name } }]
      : []),
    ...variants.map((variant, i) => {
      const photos = photoSets[i] ?? [];
      const decor = decorForVariant(choices.decor, i + offset);
      return {
        doc: composeDesign({ format, copy, variant, photos, decor, ...colours }),
        variant,
        photos,
        decor,
        copy,
        label: { layout: ARCHETYPES[variant.archetype].name, palette: PALETTES[variant.palette].name, type: PAIRINGS[variant.pairing].name },
      };
    }),
  ];

  // The creative director's review: fix what is weak, keep what scores better, lead with the best.
  await onStage("reviewing");
  const reviewed = await reviewAndRefine(slots, { brief, choices, format, colours, richCopy });
  const docs = reviewed.map((slot) => slot.doc);

  // Unsplash counts a photo as used when it lands in a design the user keeps. The first
  // direction becomes the project now; the client reports another one if it is opened.
  const photoDownloads = reviewed.map((slot) => placedPhotos(slot.doc, slot.photos).map((p) => p.downloadLocation));
  trackDownloads(photoDownloads[0]!.map((downloadLocation) => ({ downloadLocation })));

  await onStage("saving");
  const [project] = await db()
    .insert(flyerProjects)
    .values({ userId, title: copy.headline.slice(0, 120) || "Untitled flyer", format, canvas: JSON.parse(JSON.stringify(docs[0])), generationId: jobId })
    .returning({ id: flyerProjects.id });
  if (!project) throw new Error("project insert failed");

  const directions = reviewed.map((slot) => ({ ...slot.label, ...(slot.review && { score: slot.review.overall }) }));

  return {
    response: { jobId, projectId: project.id, format, docs, directions, rationale: brief.rationale, source, photoDownloads },
    record: {
      intent: storedIntent(brief.category),
      projectId: project.id,
      variations: JSON.parse(
        JSON.stringify({
          source,
          model,
          brief,
          variants: reviewed.map((slot) => slot.variant),
          reviews: reviewed.map((slot) => slot.review ?? null),
          ideogram: lead ? { prompt: lead.prompt } : null,
          photos: photoSets.map((set) => set.map((p) => p.url)),
        }),
      ),
    },
  };
}
