import type { ExportCompleteResponse, ExportStartResponse } from "@flyer/core/api/contracts";
import { EXPORT_FORMATS } from "@flyer/core/export/formats";
import { isFormatAllowed, PLANS, type ExportFormatId } from "@flyer/core/stripe/plans";
import { addCredits, deductCredits, getBalance, getProfile, Prisma, prisma } from "@flyer/db";
import { Hono } from "hono";
import { z } from "zod";

import { ApiException, parseJson, uuidParam, type AppEnv } from "../http";
import { deleteObject, headObject, presignGet, presignPut } from "../r2";
import { requireUser } from "../session";

/** Presigned GETs max out at 7 days (SigV4). */
const SHARE_SECONDS = 60 * 60 * 24 * 7;
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

const Start = z.object({
  exportId: z.string().uuid(),
  projectId: z.string().uuid(),
  format: z.enum(["png", "pdf", "png-2k", "png-4k"]),
  /** What the client rendered; must match the plan's watermark rule. */
  watermarked: z.boolean(),
});

const Finish = z.object({ status: z.enum(["complete", "failed"]) });

export const exportsRoute = new Hono<AppEnv>()
  .use(requireUser)

  /**
   * Starts an export: checks the plan, deducts credits through the Postgres function
   * (atomic, never negative, idempotent on exportId) and returns a presigned upload slot.
   */
  .post("/", async (c) => {
    const user = c.var.user;
    const { exportId, projectId, format, watermarked } = await parseJson(c, Start);
    const profile = await getProfile(user.id, user.email);
    const plan = PLANS[profile.plan];
    const spec = EXPORT_FORMATS[format];

    if (!isFormatAllowed(profile.plan, format)) {
      throw new ApiException("PLAN_LOCKED", `${spec.label} export is included with Pro and Max.`, { format });
    }
    if (plan.watermark && !watermarked) {
      throw new ApiException("PLAN_LOCKED", "Watermark-free exports are included with Pro and Max.", { format });
    }

    const project = await prisma.flyerProject.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } });
    if (!project) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");

    const key = `${user.id}/${exportId}.${spec.extension}`;

    const existing = await prisma.flyerExport.findUnique({ where: { id: exportId }, select: { userId: true, status: true } });
    if (existing && existing.userId !== user.id) throw new ApiException("CONFLICT", "Export id already in use.");
    if (existing?.status === "complete") throw new ApiException("CONFLICT", "This export already finished.");

    const charge = await deductCredits({
      userId: user.id,
      amount: spec.cost,
      reason: `export:${format}`,
      idempotencyKey: `export:${user.id}:${exportId}`,
    });
    if (!charge.ok) {
      throw new ApiException(
        "INSUFFICIENT_CREDITS",
        `${spec.label} export needs ${spec.cost} credit${spec.cost === 1 ? "" : "s"}. You have ${charge.balance}.`,
        { required: spec.cost, balance: charge.balance },
      );
    }

    if (!existing) {
      try {
        await prisma.flyerExport.create({
          data: { id: exportId, userId: user.id, projectId, format, creditsSpent: spec.cost, watermarked, storagePath: key },
        });
      } catch (error) {
        // A concurrent retry with the same id may have inserted first; the charge above was idempotent.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }

    const slot = await presignPut({ bucket: "exports", key, contentType: spec.mimeType, expiresIn: 600 });

    const response: ExportStartResponse = {
      exportId,
      uploadUrl: slot.url,
      uploadHeaders: slot.headers,
      watermark: watermarked,
      balance: charge.balance,
      replay: Boolean(existing),
    };
    return c.json(response);
  })

  /**
   * Finishes an export.
   *  complete → verifies the upload landed and returns Download + share links.
   *  failed   → the file never arrived, so the credits are returned (idempotent).
   */
  .post("/:exportId", async (c) => {
    const user = c.var.user;
    const exportId = uuidParam(c.req.param("exportId"), "We couldn't find that export.");
    const { status } = await parseJson(c, Finish);

    const row = await prisma.flyerExport.findUnique({ where: { id: exportId } });
    if (!row || row.userId !== user.id) throw new ApiException("NOT_FOUND", "We couldn't find that export.");

    let uploaded = await headObject("exports", row.storagePath);
    if (uploaded && uploaded.size > MAX_EXPORT_BYTES) {
      await deleteObject("exports", row.storagePath);
      uploaded = null;
    }

    if (status === "failed") {
      if (row.status === "complete" || uploaded) throw new ApiException("CONFLICT", "This export was delivered.");
      const balance =
        row.status === "failed"
          ? await getBalance(user.id)
          : await addCredits({
              userId: user.id,
              amount: row.creditsSpent,
              reason: "refund:export",
              idempotencyKey: `refund:export:${user.id}:${exportId}`,
            });
      await prisma.flyerExport.update({ where: { id: exportId }, data: { status: "failed", completedAt: new Date() } });
      return c.json({ balance });
    }

    if (!uploaded) throw new ApiException("UPLOAD_FAILED", "The file didn't finish uploading. Try exporting again.");

    const format = row.format as ExportFormatId;
    const filename = `flyer-${exportId.slice(0, 8)}.${EXPORT_FORMATS[format].extension}`;
    const [downloadUrl, shareUrl] = await Promise.all([
      presignGet({ bucket: "exports", key: row.storagePath, expiresIn: SHARE_SECONDS, downloadName: filename }),
      presignGet({ bucket: "exports", key: row.storagePath, expiresIn: SHARE_SECONDS }),
    ]);

    if (row.status !== "complete") {
      await prisma.flyerExport.update({ where: { id: exportId }, data: { status: "complete", completedAt: new Date() } });
    }

    const response: ExportCompleteResponse = { downloadUrl, shareUrl, format };
    return c.json(response);
  });
