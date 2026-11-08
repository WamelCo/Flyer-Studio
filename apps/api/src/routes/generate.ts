import { MAX_PROMPT_LENGTH, sanitizePrompt } from "@flyer/core/ai/prompt";
import type { GenerateResponse } from "@flyer/core/api/contracts";
import { ARCHETYPES } from "@flyer/core/design/archetypes";
import { decorForVariant, rankedChoices, storedIntent, toDesignCopy } from "@flyer/core/design/brief";
import { chooseVariants, composeDesign, hasRichCopy } from "@flyer/core/design/compose";
import { DirectorRefusal, directDesign } from "@flyer/core/design/director";
import { PALETTES } from "@flyer/core/design/palettes";
import { photosForBrief, placedPhotos, trackDownloads } from "@flyer/core/design/photos";
import { PAIRINGS } from "@flyer/core/design/typography";
import { CREDIT_COSTS } from "@flyer/core/stripe/plans";
import { addCredits, deductCredits, prisma, type Prisma } from "@flyer/db";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ApiException, parseJson, type AppEnv } from "../http";
import { requireUser } from "../session";

const VARIATIONS = 3;

const Body = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH * 2),
  format: z.enum(["poster", "square", "story", "landscape"]),
});

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * Prompt → art direction (LLM) → stock photos (Unsplash) → three composed designs.
 * No image generation: every element is editable type, shape, icon or photo frame.
 */
export const generate = new Hono<AppEnv>().use(requireUser).post("/", async (c) => {
  const user = c.var.user;
  const body = await parseJson(c, Body);

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

    const project = await prisma.$transaction(async (tx) => {
      await tx.generationJob.create({
        data: {
          id: jobId,
          userId: user.id,
          prompt,
          intent: storedIntent(brief.category),
          format: body.format,
          creditsSpent: cost,
        },
      });
      const created = await tx.flyerProject.create({
        data: {
          userId: user.id,
          title: copy.headline.slice(0, 120) || "Untitled flyer",
          format: body.format,
          canvas: json(docs[0]),
          generationId: jobId,
        },
        select: { id: true },
      });
      await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: "succeeded",
          projectId: created.id,
          completedAt: new Date(),
          variations: json({ source, model, brief, variants, photos: photoSets.map((set) => set.map((p) => p.url)) }),
        },
      });
      return created;
    });

    const directions = variants.map((v) => ({
      layout: ARCHETYPES[v.archetype].name,
      palette: PALETTES[v.palette].name,
      type: PAIRINGS[v.pairing].name,
    }));

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
    return c.json(response);
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

    await prisma.aiGenerationLog
      .create({
        data: {
          userId: user.id,
          prompt,
          errorCode: code,
          message: error instanceof Error ? error.message : String(error),
          details: { format: body.format },
        },
      })
      .catch((logError: unknown) => console.error("[generate] could not log failure", logError));

    throw new ApiException(
      code,
      blocked
        ? "Could not generate design. Please try a different prompt."
        : "We couldn't design this flyer. Your credits were returned — please try again.",
      { balance },
    );
  }
});
