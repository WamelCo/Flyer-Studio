import { getProfile } from "@flyer/billing/payments";
import { isFormatAllowed, PLANS } from "@flyer/billing/plans";
import { addCredits, db, deductCredits, eq, exports, pgError } from "@flyer/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import type { ExportStartResponse } from "@/lib/api/contracts";
import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { EXPORT_FORMAT_IDS, EXPORT_FORMATS } from "@/lib/export/formats";
import { findProject } from "@/lib/projects";
import { enforce, LIMITS } from "@/lib/rate-limit";

const Body = z.object({
  exportId: z.string().uuid(),
  projectId: z.string().uuid(),
  format: z.enum(EXPORT_FORMAT_IDS),
  /** What the client rendered; must match the plan's watermark rule. */
  watermarked: z.boolean(),
});

/**
 * Starts an export: checks the plan, deducts credits through the Postgres function (atomic,
 * never negative, idempotent on exportId) and returns where to upload the rendered file.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  await enforce(LIMITS.export(user.id), "Exporting very quickly — wait a moment and try again.");
  const { exportId, projectId, format, watermarked } = await parseJson(request, Body);
  const profile = await getProfile(user.id);
  const plan = PLANS[profile.plan];
  const spec = EXPORT_FORMATS[format];

  if (!isFormatAllowed(profile.plan, format)) {
    throw new ApiException("PLAN_LOCKED", `${spec.label} export is included with Pro and Max.`, { format });
  }
  if (plan.watermark && !watermarked) {
    throw new ApiException("PLAN_LOCKED", "Watermark-free exports are included with Pro and Max.", { format });
  }

  if (!(await findProject(user.id, projectId))) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");

  const [existing] = await db().select({ userId: exports.userId, status: exports.status }).from(exports).where(eq(exports.id, exportId)).limit(1);
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
      await db()
        .insert(exports)
        .values({ id: exportId, userId: user.id, projectId, format, creditsSpent: spec.cost, watermarked, storagePath: `${user.id}/${exportId}.${spec.extension}` });
    } catch (error) {
      // A concurrent retry with the same id may have inserted first; the charge above was idempotent.
      if (pgError(error).code !== "23505") {
        // Without a row there is nothing to refund against later, so give the credits back now.
        await addCredits({ userId: user.id, amount: spec.cost, reason: "refund:export", idempotencyKey: `refund:export:${user.id}:${exportId}` });
        throw new Error(`export insert failed: ${pgError(error).message}`);
      }
    }
  }

  const response: ExportStartResponse = {
    exportId,
    uploadUrl: `/api/export/${exportId}/file`,
    watermark: watermarked,
    balance: charge.balance,
    replay: Boolean(existing),
  };
  return NextResponse.json(response);
});
