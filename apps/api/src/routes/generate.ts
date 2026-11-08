import { MAX_PROMPT_LENGTH, sanitizePrompt } from "@flyer/core/ai/prompt";
import type { GenerateResponse, RenderResponse } from "@flyer/core/api/contracts";
import type { FlyerDoc } from "@flyer/core/canvas/types";
import { ARCHETYPES } from "@flyer/core/design/archetypes";
import { storedIntent, type DesignBrief } from "@flyer/core/design/brief";
import type { Variant } from "@flyer/core/design/compose";
import { DirectorRefusal } from "@flyer/core/design/director";
import { PALETTES } from "@flyer/core/design/palettes";
import { placedPhotos, trackDownloads } from "@flyer/core/design/photos";
import { PAIRINGS } from "@flyer/core/design/typography";
import { CREDIT_COSTS } from "@flyer/core/stripe/plans";
import { addCredits, deductCredits, getBalance, prisma, type Prisma } from "@flyer/db";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { designFlyers, renderMeta, VARIATIONS } from "../design-pipeline";
import { ApiException, parseJson, uuidParam, type AppEnv } from "../http";
import { putObject, publicUrl } from "../r2";
import { renderedDoc, renderingEnabled, renderVariants } from "../render";
import { requireUser } from "../session";

const Body = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH * 2),
  format: z.enum(["poster", "square", "story", "landscape"]),
});

const RenderBody = z.object({ variant: z.number().int().min(0).max(VARIATIONS - 1) });

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** What a job stores on generation_jobs.variations. */
interface StoredVariations {
  source: string;
  model?: string;
  brief: DesignBrief;
  variants: Variant[];
  photos: string[][];
  /** The engine designs, with paintable frames — the renderer's input. */
  designs?: FlyerDoc[];
  /** Renders delivered so far, by variant index. */
  renders?: Record<string, { url: string; seed?: number; at: string }>;
}

export const generate = new Hono<AppEnv>()
  .use(requireUser)

  /**
   * Charges credits, runs the design pipeline (art direction → three engine designs),
   * stores the job and the first design as the project. Nothing is rendered here: the
   * user picks one design and only that one is rendered (below).
   */
  .post("/", async (c) => {
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
      const { brief, source, model, copy, variants, designs, docs, photoSets, renderable } = await designFlyers(prompt, body.format);

      // Unsplash counts a photo as used when it lands in a design the user keeps. The first
      // direction becomes the project now; the client reports another one if it is opened.
      const photoDownloads = docs.map((doc, i) => placedPhotos(doc, photoSets[i] ?? []).map((photo) => photo.downloadLocation));
      trackDownloads(photoDownloads[0]!.map((downloadLocation) => ({ downloadLocation })));

      const variations: StoredVariations = { source, model, brief, variants, photos: photoSets.map((set) => set.map((p) => p.url)), designs };

      const project = await prisma.$transaction(async (tx) => {
        await tx.generationJob.create({
          data: { id: jobId, userId: user.id, prompt, intent: storedIntent(brief.category), format: body.format, creditsSpent: cost },
        });
        const created = await tx.flyerProject.create({
          data: { userId: user.id, title: copy.headline.slice(0, 120) || "Untitled flyer", format: body.format, canvas: json(docs[0]), generationId: jobId },
          select: { id: true },
        });
        await tx.generationJob.update({
          where: { id: jobId },
          data: { status: "succeeded", projectId: created.id, completedAt: new Date(), variations: json(variations) },
        });
        return created;
      });

      const response: GenerateResponse = {
        jobId,
        projectId: project.id,
        format: body.format,
        docs,
        directions: variants.map((v) => ({ layout: ARCHETYPES[v.archetype].name, palette: PALETTES[v.palette].name, type: PAIRINGS[v.pairing].name })),
        rationale: brief.rationale,
        source,
        photoDownloads,
        renderable,
        balance: charge.balance,
      };
      return c.json(response);
    } catch (error) {
      const blocked = error instanceof DirectorRefusal;
      const code = blocked ? "GENERATION_BLOCKED" : "GENERATION_FAILED";

      // Nothing was delivered, so the charge is returned (idempotent on the job id).
      const balance = await addCredits({ userId: user.id, amount: cost, reason: "refund:generate", idempotencyKey: `refund:generate:${user.id}:${jobId}` });

      await prisma.aiGenerationLog
        .create({ data: { userId: user.id, prompt, errorCode: code, message: error instanceof Error ? error.message : String(error), details: { format: body.format } } })
        .catch((logError: unknown) => console.error("[generate] could not log failure", logError));

      throw new ApiException(
        code,
        blocked ? "Could not generate design. Please try a different prompt." : "We couldn't design this flyer. Your credits were returned — please try again.",
        { balance },
      );
    }
  })

  /**
   * Renders the one design the user chose (Ideogram, from the engine's exact layout) and
   * makes it the project's canvas. The first render of a generation is included in its
   * generate charge; rendering another design from it costs CREDIT_COSTS.render.
   * Re-opening a design that was already rendered is free and calls no model.
   */
  .post("/:jobId/render", async (c) => {
    const user = c.var.user;
    const jobId = uuidParam(c.req.param("jobId"), "We couldn't find that generation.");
    const { variant } = await parseJson(c, RenderBody);
    if (!renderingEnabled()) throw new ApiException("AI_NOT_CONFIGURED", "Rendering isn't set up on this server.");

    const job = await prisma.generationJob.findFirst({ where: { id: jobId, userId: user.id }, select: { variations: true, projectId: true, prompt: true } });
    if (!job?.projectId) throw new ApiException("NOT_FOUND", "We couldn't find that generation.");
    const stored = job.variations as unknown as StoredVariations;
    const design = stored.designs?.[variant];
    const chosen = stored.variants?.[variant];
    if (!design || !chosen) throw new ApiException("NOT_FOUND", "That design isn't available to render.");
    const projectId = job.projectId;

    const deliver = async (url: string, charged: number, balance: number, renders: StoredVariations["renders"]) => {
      const doc = renderedDoc(design, url);
      await prisma.$transaction([
        prisma.flyerProject.update({
          where: { id: projectId, userId: user.id },
          data: { canvas: json(doc), thumbnailUrl: url, revision: { increment: 1 } },
        }),
        prisma.generationJob.update({ where: { id: jobId }, data: { variations: json({ ...stored, renders }) } }),
      ]);
      const response: RenderResponse = { doc, thumbnailUrl: url, charged, balance };
      return c.json(response);
    };

    // Already rendered: deliver it again, no charge, no model call.
    const existing = stored.renders?.[String(variant)];
    if (existing) return deliver(existing.url, 0, await getBalance(user.id), stored.renders);

    // The first render of a generation is included. (Two different designs rendered at the
    // same instant could both count as the first — the UI renders one at a time.)
    const included = Object.keys(stored.renders ?? {}).length === 0;
    const cost = included ? 0 : CREDIT_COSTS.render;
    const chargeKey = `render:${user.id}:${jobId}:${variant}`;
    let balance = await getBalance(user.id);
    if (cost > 0) {
      const charge = await deductCredits({ userId: user.id, amount: cost, reason: "render", idempotencyKey: chargeKey });
      if (!charge.ok) {
        throw new ApiException("INSUFFICIENT_CREDITS", `Rendering another design needs ${cost} credits. You have ${charge.balance}.`, {
          required: cost,
          balance: charge.balance,
        });
      }
      balance = charge.balance;
    }

    const [result] = await renderVariants([design], [renderMeta(stored.brief, chosen)], async (bytes) => {
      const key = `${user.id}/renders/${jobId}-${variant}.png`;
      await putObject("public", key, bytes, "image/png");
      return publicUrl(key);
    });

    if (!result?.rendered) {
      if (cost > 0) balance = await addCredits({ userId: user.id, amount: cost, reason: "refund:render", idempotencyKey: `refund:${chargeKey}` });
      await prisma.aiGenerationLog
        .create({ data: { userId: user.id, jobId, prompt: job.prompt, errorCode: "RENDER_FAILED", message: result?.error ?? "unknown", details: { variant } } })
        .catch((logError: unknown) => console.error("[render] could not log failure", logError));
      throw new ApiException("GENERATION_FAILED", "We couldn't render this design right now. Open the editable version instead — nothing was charged.", { balance });
    }

    const url = (result.doc.nodes[0] as { src: string }).src;
    return deliver(url, cost, balance, { ...stored.renders, [String(variant)]: { url, seed: result.seed, at: new Date().toISOString() } });
  });
