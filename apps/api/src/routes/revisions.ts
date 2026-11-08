import type { RevisionListResponse, RevisionStatus, RevisionSummary } from "@flyer/core/api/contracts";
import type { FlyerDoc, ImageNode } from "@flyer/core/canvas/types";
import { CREDIT_COSTS } from "@flyer/core/stripe/plans";
import { addCredits, deductCredits, getBalance, prisma, type Prisma } from "@flyer/db";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { ApiException, parseJson, uuidParam, type AppEnv } from "../http";
import { putObject, publicUrl } from "../r2";
import { collectRender, renderedDoc, renderingEnabled } from "../render";
import { startRevision } from "../revise";
import { requireUser } from "../session";

/*
 * Revisions of a rendered flyer: "change the price to US$20", "make the button green".
 * Each one is a precise edit of the current render, masked to the elements the
 * instruction names, so everything else stays pixel for pixel. Like renders, a revision
 * starts and returns at once; the client polls until it finishes (15–60s).
 */

const Body = z.object({ instruction: z.string().trim().min(3).max(400) });

/** A revision still pending after this long is failed and refunded. */
const REVISION_DEADLINE_MS = 10 * 60_000;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

type Row = Awaited<ReturnType<typeof prisma.projectRevision.findFirstOrThrow>>;

function summary(row: Row): RevisionSummary {
  const targets = Array.isArray(row.targets) ? (row.targets as { label?: string }[]).map((t) => t.label ?? "").filter(Boolean) : [];
  return {
    id: row.id,
    instruction: row.instruction,
    status: row.status as RevisionSummary["status"],
    targets,
    sourceUrl: row.sourceUrl,
    resultUrl: row.resultUrl,
    charged: row.creditsSpent,
    createdAt: row.createdAt.toISOString(),
  };
}

const projectIdOf = (c: Context<AppEnv>) => uuidParam(c.req.param("projectId") ?? "", "We couldn't find that project.");

/** The full-page rendered image a project's canvas shows, if it is a rendered flyer. */
function renderedImage(canvas: unknown): ImageNode | null {
  const doc = canvas as FlyerDoc | null;
  const node = doc?.nodes?.find((n): n is ImageNode => n.type === "image" && n.name === "Rendered design");
  return node ?? null;
}

async function loadProject(projectId: string, userId: string) {
  const project = await prisma.flyerProject.findFirst({
    where: { id: projectId, userId },
    select: { id: true, canvas: true, generation: { select: { variations: true } } },
  });
  if (!project) throw new ApiException("NOT_FOUND", "We couldn't find that project.");
  return project;
}

/**
 * The engine design behind the current image: the render it descends from (walking back
 * through earlier revisions) tells which of the generation's designs it is. Without one
 * the revision still runs, unmasked.
 */
async function designFor(projectId: string, variations: unknown, currentUrl: string): Promise<FlyerDoc | null> {
  const stored = variations as { designs?: FlyerDoc[]; renders?: Record<string, { status: string; url?: string }> } | null;
  if (!stored?.designs || !stored.renders) return null;
  const byUrl = new Map(Object.entries(stored.renders).flatMap(([variant, r]) => (r.status === "done" && r.url ? [[r.url, Number(variant)] as const] : [])));
  const done = await prisma.projectRevision.findMany({ where: { projectId, status: "done" }, select: { sourceUrl: true, resultUrl: true } });
  const parent = new Map(done.map((r) => [r.resultUrl, r.sourceUrl]));
  let url: string | undefined = currentUrl;
  for (let hops = 0; url && hops < 50; hops++) {
    const variant = byUrl.get(url);
    if (variant !== undefined) return stored.designs[variant] ?? null;
    url = parent.get(url);
  }
  return null;
}

export const revisions = new Hono<AppEnv>()
  .use(requireUser)

  .get("/", async (c) => {
    const user = c.var.user;
    const projectId = projectIdOf(c);
    await loadProject(projectId, user.id);
    const rows = await prisma.projectRevision.findMany({ where: { projectId, userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
    const response: RevisionListResponse = { revisions: rows.map(summary) };
    return c.json(response);
  })

  /** Charges a revision and starts the precise edit of the current render. */
  .post("/", async (c) => {
    const user = c.var.user;
    const projectId = projectIdOf(c);
    const { instruction } = await parseJson(c, Body);
    if (!renderingEnabled()) throw new ApiException("AI_NOT_CONFIGURED", "Revisions aren't set up on this server.");

    const project = await loadProject(projectId, user.id);
    const image = renderedImage(project.canvas);
    if (!image) throw new ApiException("VALIDATION_ERROR", "Only rendered flyers can be revised. Render a design first.");
    const busy = await prisma.projectRevision.findFirst({ where: { projectId, status: "pending", createdAt: { gt: new Date(Date.now() - REVISION_DEADLINE_MS) } } });
    if (busy) throw new ApiException("CONFLICT", "A revision of this flyer is already in progress.");

    const cost = CREDIT_COSTS.revise;
    const row = await prisma.projectRevision.create({ data: { projectId, userId: user.id, instruction, sourceUrl: image.src, creditsSpent: cost } });
    const chargeKey = `revise:${user.id}:${row.id}`;
    const charge = await deductCredits({ userId: user.id, amount: cost, reason: "revise", idempotencyKey: chargeKey });
    if (!charge.ok) {
      await prisma.projectRevision.delete({ where: { id: row.id } });
      throw new ApiException("INSUFFICIENT_CREDITS", `A revision needs ${cost} credits. You have ${charge.balance}.`, { required: cost, balance: charge.balance });
    }

    try {
      const source = await fetch(image.src, { signal: AbortSignal.timeout(30_000) });
      if (!source.ok) throw new Error(`source image ${source.status}`);
      const design = await designFor(projectId, project.generation?.variations, image.src);
      const started = await startRevision(new Uint8Array(await source.arrayBuffer()), instruction, design);
      const updated = await prisma.projectRevision.update({
        where: { id: row.id },
        data: { generationId: started.generationId, chargeKey, targets: json(started.targets) },
      });
      const pending: RevisionStatus = { ...summary(updated), status: "pending", balance: charge.balance };
      return c.json(pending, 202);
    } catch (error) {
      const balance = await addCredits({ userId: user.id, amount: cost, reason: "refund:revise", idempotencyKey: `refund:${chargeKey}` });
      const message = error instanceof Error ? error.message : String(error);
      await prisma.projectRevision.update({ where: { id: row.id }, data: { status: "failed", error: message, creditsSpent: 0, completedAt: new Date() } });
      await logFailure(user.id, instruction, message);
      throw new ApiException("GENERATION_FAILED", "We couldn't start this revision. Nothing was charged.", { balance });
    }
  })

  /** Polls a revision; the first poll that sees it finished makes it the project's canvas. */
  .get("/:revisionId", async (c) => {
    const user = c.var.user;
    const projectId = projectIdOf(c);
    const revisionId = uuidParam(c.req.param("revisionId"), "We couldn't find that revision.");
    const row = await prisma.projectRevision.findFirst({ where: { id: revisionId, projectId, userId: user.id } });
    if (!row) throw new ApiException("NOT_FOUND", "We couldn't find that revision.");

    const project = await loadProject(projectId, user.id);
    const doc = () => renderedDoc(project.canvas as unknown as FlyerDoc, row.resultUrl!);
    if (row.status === "done") {
      const done: RevisionStatus = { ...summary(row), status: "done", doc: doc(), balance: await getBalance(user.id) };
      return c.json(done);
    }
    if (row.status === "failed") throw new ApiException("GENERATION_FAILED", failedMessage(row.creditsSpent), { balance: await getBalance(user.id) });

    const fail = async (reason: string) => {
      const balance = row.chargeKey
        ? await addCredits({ userId: user.id, amount: row.creditsSpent, reason: "refund:revise", idempotencyKey: `refund:${row.chargeKey}` })
        : await getBalance(user.id);
      await prisma.projectRevision.update({ where: { id: row.id }, data: { status: "failed", error: reason, completedAt: new Date() } });
      await logFailure(user.id, row.instruction, reason);
      throw new ApiException("GENERATION_FAILED", failedMessage(row.creditsSpent), { balance });
    };

    if (Date.now() - row.createdAt.getTime() > REVISION_DEADLINE_MS || !row.generationId) return fail("timed out waiting for the renderer");
    const result = await collectRender(row.generationId, async (bytes) => {
      const key = `${user.id}/revisions/${row.id}.png`;
      await putObject("public", key, bytes, "image/png");
      return publicUrl(key);
    });
    if (result.status === "failed") return fail(result.reason);
    if (result.status === "pending") {
      const pending: RevisionStatus = { ...summary(row), status: "pending", balance: await getBalance(user.id) };
      return c.json(pending, 202);
    }

    const canvas = renderedDoc(project.canvas as unknown as FlyerDoc, result.url);
    const [updated] = await prisma.$transaction([
      prisma.projectRevision.update({ where: { id: row.id }, data: { status: "done", resultUrl: result.url, completedAt: new Date() } }),
      prisma.flyerProject.update({ where: { id: projectId, userId: user.id }, data: { canvas: json(canvas), thumbnailUrl: result.url, revision: { increment: 1 } } }),
    ]);
    const done: RevisionStatus = { ...summary(updated), status: "done", doc: canvas, balance: await getBalance(user.id) };
    return c.json(done);
  })

  /** Puts the image a revision started from back on the canvas. Free. */
  .post("/:revisionId/undo", async (c) => {
    const user = c.var.user;
    const projectId = projectIdOf(c);
    const revisionId = uuidParam(c.req.param("revisionId"), "We couldn't find that revision.");
    const row = await prisma.projectRevision.findFirst({ where: { id: revisionId, projectId, userId: user.id, status: "done" } });
    if (!row) throw new ApiException("NOT_FOUND", "We couldn't find that revision.");
    const project = await loadProject(projectId, user.id);
    const canvas = renderedDoc(project.canvas as unknown as FlyerDoc, row.sourceUrl);
    await prisma.flyerProject.update({ where: { id: projectId, userId: user.id }, data: { canvas: json(canvas), thumbnailUrl: row.sourceUrl, revision: { increment: 1 } } });
    return c.json({ doc: canvas, thumbnailUrl: row.sourceUrl });
  });

function failedMessage(charged: number) {
  return `We couldn't apply this revision right now${charged > 0 ? " — your credits were returned" : ""}. Try again, or rephrase it.`;
}

async function logFailure(userId: string, prompt: string, message: string) {
  await prisma.aiGenerationLog
    .create({ data: { userId, prompt, errorCode: "REVISION_FAILED", message } })
    .catch((error: unknown) => console.error("[revise] could not log failure", error));
}
