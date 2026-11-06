import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { MAX_PROMPT_LENGTH, sanitizePrompt } from "@/lib/ai/prompt";
import type { GenerateResponse } from "@/lib/api/contracts";
import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { ARCHETYPES } from "@/lib/design/archetypes";
import { decorForVariant, rankedChoices, storedIntent, toDesignCopy } from "@/lib/design/brief";
import { chooseVariants, composeDesign, hasRichCopy } from "@/lib/design/compose";
import { DirectorRefusal, directDesign } from "@/lib/design/director";
import { PALETTES } from "@/lib/design/palettes";
import { photosForBrief, placedPhotos, trackDownloads } from "@/lib/design/photos";
import { PAIRINGS } from "@/lib/design/typography";
import { addCredits, deductCredits } from "@/lib/db/credits";
import { CREDIT_COSTS } from "@/lib/stripe/plans";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 90;

const VARIATIONS = 3;

const Body = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH * 2),
  format: z.enum(["poster", "square", "story", "landscape"]),
});

/**
 * Prompt → art direction (Claude) → stock photos (Unsplash) → three composed designs.
 * No image generation: every element is editable type, shape, icon or photo frame.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const body = await parseJson(request, Body);

  const prompt = sanitizePrompt(body.prompt);
  if (prompt.length < 3) throw new ApiException("VALIDATION_ERROR", "Describe your flyer in a few words.");

  const jobId = randomUUID();
  const cost = CREDIT_COSTS.generate;

  // Credit check + deduction happen atomically in Postgres before any paid work starts.
  const charge = await deductCredits({ userId: user.id, amount: cost, reason: "generate", idempotencyKey: `generate:${user.id}:${jobId}` });
  if (!charge.ok) {
    throw new ApiException("INSUFFICIENT_CREDITS", `Generating needs ${cost} credits. You have ${charge.balance}.`, {
      required: cost,
      balance: charge.balance,
    });
  }

  const admin = createAdminClient();

  try {
    const { brief, source, model } = await directDesign(prompt, body.format);
    const copy = toDesignCopy(brief);
    const choices = rankedChoices(brief);
    const photoSets = await photosForBrief(brief.photoQueries, body.format, VARIATIONS);
    const variants = chooseVariants(choices, {
      count: VARIATIONS,
      hasPhotos: photoSets.every((set) => set.length > 0),
      richCopy: hasRichCopy(copy),
    });

    const docs = variants.map((variant, i) =>
      composeDesign({
        format: body.format,
        copy,
        variant,
        photos: photoSets[i] ?? [],
        decor: decorForVariant(choices.decor, i),
        brandColor: choices.brandColor,
      }),
    );
    // Unsplash counts a photo as used when it lands in a design the user keeps. The first
    // direction becomes the project now; the client reports another one if it is opened.
    const photoDownloads = docs.map((doc, i) => placedPhotos(doc, photoSets[i] ?? []).map((photo) => photo.downloadLocation));
    trackDownloads(photoDownloads[0]!.map((downloadLocation) => ({ downloadLocation })));

    await admin.from("generation_jobs").insert({
      id: jobId,
      user_id: user.id,
      prompt,
      intent: storedIntent(brief.category),
      format: body.format,
      credits_spent: cost,
    });

    const { data: project, error: projectError } = await admin
      .from("flyer_projects")
      .insert({
        user_id: user.id,
        title: copy.headline.slice(0, 120),
        format: body.format,
        canvas: JSON.parse(JSON.stringify(docs[0])),
        generation_id: jobId,
      })
      .select("id")
      .single();
    if (projectError) throw new Error(`project insert failed: ${projectError.message}`);

    const directions = variants.map((v) => ({
      layout: ARCHETYPES[v.archetype].name,
      palette: PALETTES[v.palette].name,
      type: PAIRINGS[v.pairing].name,
    }));

    await admin
      .from("generation_jobs")
      .update({
        status: "succeeded",
        project_id: project.id,
        completed_at: new Date().toISOString(),
        variations: JSON.parse(JSON.stringify({ source, model, brief, variants, photos: photoSets.map((set) => set.map((p) => p.url)) })),
      })
      .eq("id", jobId);

    const response: GenerateResponse = {
      jobId,
      projectId: project.id,
      format: body.format,
      docs,
      directions,
      rationale: brief.rationale,
      source,
      photoDownloads,
      balance: charge.balance,
    };
    return NextResponse.json(response);
  } catch (error) {
    const blocked = error instanceof DirectorRefusal;
    const code = blocked ? "GENERATION_BLOCKED" : "GENERATION_FAILED";

    // Nothing was delivered, so the charge is returned (idempotent on the job id).
    const balance = await addCredits({
      userId: user.id,
      amount: cost,
      reason: "refund:generate",
      idempotencyKey: `refund:generate:${user.id}:${jobId}`,
    });

    await admin.from("ai_generation_logs").insert({
      user_id: user.id,
      prompt,
      error_code: code,
      message: error instanceof Error ? error.message : String(error),
      details: { format: body.format },
    });

    throw new ApiException(
      code,
      blocked
        ? "Could not generate design. Please try a different prompt."
        : "We couldn't design this flyer. Your credits were returned — please try again.",
      { balance },
    );
  }
});
