import { MAX_PROMPT_LENGTH, sanitizePrompt } from "@flyer/core/ai/prompt";
import type { GenerateResponse, RenderStatus } from "@flyer/core/api/contracts";
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
import { collectRender, renderedDoc, renderingEnabled, startDesignRender } from "../render";
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
  /** Renders by variant index: started, delivered or failed. */
  renders?: Record<string, StoredRender>;
}

/** One design's render, tracked across the start and poll requests. */
interface StoredRender {
  status: "pending" | "done" | "failed";
  /** Ideogram's generation id, polled until the render finishes. */
  generationId?: string;
  url?: string;
  seed?: number;
  /** Credits charged for this render (0 when it was the included one). */
  charged: number;
  /** The ledger key it was charged under, so a refund is idempotent. */
  chargeKey?: string;
  startedAt: string;
  error?: string;
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
   * Starts rendering the one design the user chose (Ideogram, from the engine's exact
   * layout). Returns at once with "pending" — the client polls the GET below — or "done"
   * when this design was already rendered. The first render of a generation is included
   * in its generate charge; rendering another design from it costs CREDIT_COSTS.render.
   */
  .post("/:jobId/render", async (c) => {
    const user = c.var.user;
    const jobId = uuidParam(c.req.param("jobId"), "We couldn't find that generation.");
    const { variant } = await parseJson(c, RenderBody);
    if (!renderingEnabled()) throw new ApiException("AI_NOT_CONFIGURED", "Rendering isn't set up on this server.");

    const job = await loadJob(jobId, user.id);
    const design = job.stored.designs?.[variant];
    const chosen = job.stored.variants?.[variant];
    if (!design || !chosen) throw new ApiException("NOT_FOUND", "That design isn't available to render.");

    const existing = job.stored.renders?.[String(variant)];
    if (existing?.status === "done") return c.json(await doneStatus(job, variant, existing, user.id));
    if (existing?.status === "pending" && !stale(existing)) {
      const pending: RenderStatus = { status: "pending", startedAt: existing.startedAt, charged: existing.charged, balance: await getBalance(user.id) };
      return c.json(pending, 202);
    }

    // The first render is included; failed renders were refunded and don't count.
    // (Two designs started at the same instant could both count as the first — the UI
    // renders one at a time.)
    const used = Object.values(job.stored.renders ?? {}).filter((r) => r.status === "done" || r.status === "pending").length;
    const cost = used === 0 ? 0 : CREDIT_COSTS.render;
    const startedAt = new Date().toISOString();
    const chargeKey = `render:${user.id}:${jobId}:${variant}:${startedAt}`;
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

    let generationId: string;
    try {
      ({ generationId } = await startDesignRender(design, renderMeta(job.stored.brief, chosen)));
    } catch (error) {
      if (cost > 0) balance = await addCredits({ userId: user.id, amount: cost, reason: "refund:render", idempotencyKey: `refund:${chargeKey}` });
      await logRenderFailure(user.id, jobId, job.prompt, variant, error instanceof Error ? error.message : String(error));
      throw new ApiException("GENERATION_FAILED", "We couldn't start rendering this design. Open the editable version instead — nothing was charged.", { balance });
    }

    await saveRender(jobId, job.stored, variant, { status: "pending", generationId, charged: cost, chargeKey, startedAt });
    const pending: RenderStatus = { status: "pending", startedAt, charged: cost, balance };
    return c.json(pending, 202);
  })

  /**
   * Polls a render started above. Each poll asks the renderer; the first poll that sees
   * it finished stores the image in R2 and makes it the project's canvas. Stateless, so
   * restarts and multiple API instances are fine.
   */
  .get("/:jobId/render/:variant", async (c) => {
    const user = c.var.user;
    const jobId = uuidParam(c.req.param("jobId"), "We couldn't find that generation.");
    const variant = Number(c.req.param("variant"));
    if (!Number.isInteger(variant) || variant < 0 || variant >= VARIATIONS) throw new ApiException("NOT_FOUND", "We couldn't find that render.");

    const job = await loadJob(jobId, user.id);
    const entry = job.stored.renders?.[String(variant)];
    const design = job.stored.designs?.[variant];
    if (!entry || !design) throw new ApiException("NOT_FOUND", "That render hasn't been started.");
    if (entry.status === "done") return c.json(await doneStatus(job, variant, entry, user.id));
    if (entry.status === "failed") throw new ApiException("GENERATION_FAILED", renderFailedMessage(entry.charged), { balance: await getBalance(user.id) });

    const fail = async (reason: string) => {
      const balance =
        entry.charged > 0
          ? await addCredits({ userId: user.id, amount: entry.charged, reason: "refund:render", idempotencyKey: `refund:${entry.chargeKey}` })
          : await getBalance(user.id);
      await saveRender(jobId, job.stored, variant, { ...entry, status: "failed", error: reason });
      await logRenderFailure(user.id, jobId, job.prompt, variant, reason);
      throw new ApiException("GENERATION_FAILED", renderFailedMessage(entry.charged), { balance });
    };

    if (stale(entry)) return fail("timed out waiting for the renderer");
    const result = await collectRender(entry.generationId!, async (bytes) => {
      const key = `${user.id}/renders/${jobId}-${variant}.png`;
      await putObject("public", key, bytes, "image/png");
      return publicUrl(key);
    });
    if (result.status === "failed") return fail(result.reason);
    if (result.status === "pending") {
      const pending: RenderStatus = { status: "pending", startedAt: entry.startedAt, charged: entry.charged, balance: await getBalance(user.id) };
      return c.json(pending, 202);
    }

    const done: StoredRender = { ...entry, status: "done", url: result.url, seed: result.seed };
    // The render becomes the project's canvas and thumbnail.
    const doc = renderedDoc(design, result.url);
    await prisma.$transaction([
      prisma.flyerProject.update({ where: { id: job.projectId, userId: user.id }, data: { canvas: json(doc), thumbnailUrl: result.url, revision: { increment: 1 } } }),
      prisma.generationJob.update({ where: { id: jobId }, data: { variations: json(withRender(job.stored, variant, done)) } }),
    ]);
    return c.json(await doneStatus(job, variant, done, user.id));
  });

// ── Render bookkeeping ─────────────────────────────────────────────────────────

/** A render that hasn't finished after this long is treated as failed (and refunded). */
const RENDER_DEADLINE_MS = 10 * 60_000;

function stale(entry: StoredRender) {
  return entry.status === "pending" && Date.now() - Date.parse(entry.startedAt) > RENDER_DEADLINE_MS;
}

function renderFailedMessage(charged: number) {
  return `We couldn't render this design right now. Open the editable version instead${charged > 0 ? " — your credits were returned" : " — nothing was charged"}.`;
}

async function loadJob(jobId: string, userId: string) {
  const job = await prisma.generationJob.findFirst({ where: { id: jobId, userId }, select: { variations: true, projectId: true, prompt: true } });
  if (!job?.projectId) throw new ApiException("NOT_FOUND", "We couldn't find that generation.");
  return { projectId: job.projectId, prompt: job.prompt, stored: job.variations as unknown as StoredVariations };
}

function withRender(stored: StoredVariations, variant: number, entry: StoredRender): StoredVariations {
  return { ...stored, renders: { ...stored.renders, [String(variant)]: entry } };
}

async function saveRender(jobId: string, stored: StoredVariations, variant: number, entry: StoredRender) {
  await prisma.generationJob.update({ where: { id: jobId }, data: { variations: json(withRender(stored, variant, entry)) } });
}

async function doneStatus(job: { stored: StoredVariations }, variant: number, entry: StoredRender, userId: string): Promise<RenderStatus> {
  const design = job.stored.designs![variant]!;
  return { status: "done", doc: renderedDoc(design, entry.url!), thumbnailUrl: entry.url!, charged: entry.charged, balance: await getBalance(userId) };
}

async function logRenderFailure(userId: string, jobId: string, prompt: string, variant: number, message: string) {
  await prisma.aiGenerationLog
    .create({ data: { userId, jobId, prompt, errorCode: "RENDER_FAILED", message, details: { variant } } })
    .catch((error: unknown) => console.error("[render] could not log failure", error));
}
