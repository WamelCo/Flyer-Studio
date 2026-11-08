import { MAX_PROMPT_LENGTH, sanitizePrompt } from "@flyer/core/ai/prompt";
import type { GenerateResponse } from "@flyer/core/api/contracts";
import { ARCHETYPES } from "@flyer/core/design/archetypes";
import { storedIntent } from "@flyer/core/design/brief";
import { DirectorRefusal } from "@flyer/core/design/director";
import { PALETTES } from "@flyer/core/design/palettes";
import { placedPhotos, trackDownloads } from "@flyer/core/design/photos";
import { PAIRINGS } from "@flyer/core/design/typography";
import { CREDIT_COSTS } from "@flyer/core/stripe/plans";
import { addCredits, deductCredits, prisma, type Prisma } from "@flyer/db";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { designFlyers } from "../design-pipeline";
import { ApiException, parseJson, type AppEnv } from "../http";
import { putObject, publicUrl } from "../r2";
import { requireUser } from "../session";

const Body = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH * 2),
  format: z.enum(["poster", "square", "story", "landscape"]),
});

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * Charges credits, runs the design pipeline (design-pipeline.ts: art direction → engine
 * layouts → optional renderer), stores the job and the first design as the project.
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
    const { brief, source, model, copy, variants, designs, renders, docs, photoSets } = await designFlyers(prompt, body.format, async (bytes, i) => {
      const key = `${user.id}/renders/${jobId}-${i}.png`;
      await putObject("public", key, bytes, "image/png");
      return publicUrl(key);
    });

    // Unsplash counts a photo as used when it lands in a design the user keeps. The first
    // direction becomes the project now; the client reports another one if it is opened.
    // Rendered designs contain no stock photos, so they report none.
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
          variations: json({
            source,
            model,
            brief,
            variants,
            photos: photoSets.map((set) => set.map((p) => p.url)),
            // The editable engine designs, kept when a render was delivered instead.
            ...(renders && {
              designs,
              renders: renders.map(({ rendered, seed, error, prompt }) => ({ rendered, seed, error, prompt })),
            }),
          }),
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
      rendered: renders ? renders.map((render) => render.rendered) : docs.map(() => false),
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
