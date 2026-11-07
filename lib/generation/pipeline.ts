import type { FlyerFormat } from "@/lib/canvas/types";
import type { GenerateResponse } from "@/lib/api/contracts";
import type { Json } from "@/lib/db/types";
import { ARCHETYPES } from "@/lib/design/archetypes";
import { decorForVariant, rankedChoices, storedIntent, toDesignCopy } from "@/lib/design/brief";
import { chooseVariants, composeDesign, hasRichCopy } from "@/lib/design/compose";
import { directDesign } from "@/lib/design/director";
import { ideogramConfigured, ideogramDirection } from "@/lib/design/ideogram";
import { PALETTES, withBrandColor } from "@/lib/design/palettes";
import { photosForBrief, placedPhotos, trackDownloads } from "@/lib/design/photos";
import { PAIRINGS } from "@/lib/design/typography";
import { ideogramAllowed } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const VARIATIONS = 3;

/** Where a job is, in the order it happens. The client shows a sentence for each. */
export const STAGES = ["queued", "directing", "designing", "composing", "saving"] as const;
export type Stage = (typeof STAGES)[number];

export interface GenerationInput {
  jobId: string;
  userId: string;
  prompt: string;
  format: FlyerFormat;
  cost: number;
}

/**
 * Prompt → art direction (Qwen / Claude, fact-checked) → three directions: the lead one
 * designed by Ideogram with its text lifted into editable layers (when configured and
 * under the spend cap), the others composed by the layout engine with stock photos.
 * Persists the project and returns what the client shows (balance filled in by the caller).
 */
/** What the finished job records on its row (besides status and result). */
export interface JobRecord {
  intent: string;
  project_id: string;
  variations: Json;
}

export async function designFlyer(input: GenerationInput, onStage: (stage: Stage) => Promise<void>): Promise<{ response: Omit<GenerateResponse, "balance">; record: JobRecord }> {
  const { jobId, userId, prompt, format } = input;
  const admin = createAdminClient();

  await onStage("directing");
  const { brief, source, model } = await directDesign(prompt, format);
  const copy = toDesignCopy(brief);
  const choices = rankedChoices(brief);
  const colours = { brandColor: choices.brandColor, accentColor: choices.accentColor };

  await onStage("designing");
  // The Ideogram lead and the stock-photo search don't depend on each other.
  const useIdeogram = ideogramConfigured() && (await ideogramAllowed(userId));
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
  const ranked = chooseVariants(choices, { count: VARIATIONS, hasPhotos: photoSets.every((set) => set.length > 0), richCopy: hasRichCopy(copy) });
  // With an Ideogram lead (first palette and pairing), the engine designs the other two
  // directions in the second and third, keeping its best layouts.
  const variants = lead ? ranked.slice(0, 2).map((v, i) => ({ ...v, palette: ranked[i + 1]!.palette, pairing: ranked[i + 1]!.pairing })) : ranked;
  const offset = lead ? 1 : 0;
  const engineDocs = variants.map((variant, i) =>
    composeDesign({ format, copy, variant, photos: photoSets[i] ?? [], decor: decorForVariant(choices.decor, i + offset), ...colours }),
  );
  const docs = lead ? [lead.doc, ...engineDocs] : engineDocs;

  // Unsplash counts a photo as used when it lands in a design the user keeps. The first
  // direction becomes the project now; the client reports another one if it is opened.
  const photoDownloads = [...(lead ? [[] as string[]] : []), ...engineDocs.map((doc, i) => placedPhotos(doc, photoSets[i] ?? []).map((p) => p.downloadLocation))];
  trackDownloads(photoDownloads[0]!.map((downloadLocation) => ({ downloadLocation })));

  await onStage("saving");
  const { data: project, error: projectError } = await admin
    .from("flyer_projects")
    .insert({ user_id: userId, title: copy.headline.slice(0, 120), format, canvas: JSON.parse(JSON.stringify(docs[0])), generation_id: jobId })
    .select("id")
    .single();
  if (projectError) throw new Error(`project insert failed: ${projectError.message}`);

  const directions = [
    ...(lead ? [{ layout: "Ideogram design", palette: PALETTES[choices.palettes[0]!].name, type: PAIRINGS[choices.pairings[0]!].name }] : []),
    ...variants.map((v) => ({ layout: ARCHETYPES[v.archetype].name, palette: PALETTES[v.palette].name, type: PAIRINGS[v.pairing].name })),
  ];

  return {
    response: { jobId, projectId: project.id, format, docs, directions, rationale: brief.rationale, source, photoDownloads },
    record: {
      intent: storedIntent(brief.category),
      project_id: project.id,
      variations: JSON.parse(
        JSON.stringify({ source, model, brief, variants, ideogram: lead ? { prompt: lead.prompt } : null, photos: photoSets.map((set) => set.map((p) => p.url)) }),
      ),
    },
  };
}
