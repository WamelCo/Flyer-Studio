import type { ExportFormatId } from "@flyer/billing/plans";
import { addCredits, and, db, eq, exports, getBalance } from "@flyer/db";
import { headObject, presignGet } from "@flyer/storage";
import { NextResponse } from "next/server";
import { z } from "zod";

import type { ExportCompleteResponse } from "@/lib/api/contracts";
import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { EXPORT_FORMATS } from "@/lib/export/formats";

const SHARE_SECONDS = 60 * 60 * 24 * 7;

const Body = z.object({ status: z.enum(["complete", "failed"]) });

/**
 * Finishes an export.
 *  complete → verifies the upload landed and returns Download + share links.
 *  failed   → the file never arrived, so the credits are returned (idempotent).
 */
export const POST = handle(async (request: Request, { params }: RouteContext<"/api/export/[exportId]">) => {
  const user = await requireUser();
  const { exportId } = await params;
  const { status } = await parseJson(request, Body);
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new ApiException("NOT_FOUND", "We couldn't find that export.");

  const [row] = await db()
    .select({ format: exports.format, status: exports.status, storagePath: exports.storagePath, creditsSpent: exports.creditsSpent })
    .from(exports)
    .where(and(eq(exports.id, exportId), eq(exports.userId, user.id)))
    .limit(1);
  if (!row) throw new ApiException("NOT_FOUND", "We couldn't find that export.");

  const uploaded = (await headObject("private", row.storagePath)) !== null;

  if (status === "failed") {
    if (row.status === "complete" || uploaded) throw new ApiException("CONFLICT", "This export was delivered.");
    const balance =
      row.status === "failed"
        ? await getBalance(user.id)
        : await addCredits({ userId: user.id, amount: row.creditsSpent, reason: "refund:export", idempotencyKey: `refund:export:${user.id}:${exportId}` });
    await db().update(exports).set({ status: "failed", completedAt: new Date() }).where(eq(exports.id, exportId));
    return NextResponse.json({ balance });
  }

  if (!uploaded) throw new ApiException("UPLOAD_FAILED", "The file didn't finish uploading. Try exporting again.");

  const format = row.format as ExportFormatId;
  const filename = `flyer-${exportId.slice(0, 8)}.${EXPORT_FORMATS[format].extension}`;
  const [downloadUrl, shareUrl] = await Promise.all([
    presignGet("private", row.storagePath, { expiresIn: SHARE_SECONDS, downloadName: filename }),
    presignGet("private", row.storagePath, { expiresIn: SHARE_SECONDS }),
  ]);

  if (row.status !== "complete") {
    await db().update(exports).set({ status: "complete", completedAt: new Date() }).where(eq(exports.id, exportId));
  }

  const response: ExportCompleteResponse = { downloadUrl, shareUrl, format };
  return NextResponse.json(response);
});
