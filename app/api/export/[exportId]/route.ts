import { NextResponse } from "next/server";
import { z } from "zod";

import type { ExportCompleteResponse } from "@/lib/api/contracts";
import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { addCredits, getBalance } from "@/lib/db/credits";
import { EXPORT_FORMATS } from "@/lib/export/formats";
import type { ExportFormatId } from "@/lib/stripe/plans";
import { createAdminClient } from "@/lib/supabase/admin";

const SHARE_SECONDS = 60 * 60 * 24 * 7;

const Body = z.object({ status: z.enum(["complete", "failed"]) });

async function objectExists(path: string) {
  const admin = createAdminClient();
  const slash = path.lastIndexOf("/");
  const { data } = await admin.storage.from("exports").list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 1 });
  return Boolean(data?.some((object) => object.name === path.slice(slash + 1)));
}

/**
 * Finishes an export.
 *  complete → verifies the upload landed and returns Download + share links.
 *  failed   → the file never arrived, so the credits are returned (idempotent).
 */
export const POST = handle(async (request: Request, { params }: RouteContext<"/api/export/[exportId]">) => {
  const user = await requireUser();
  const { exportId } = await params;
  const { status } = await parseJson(request, Body);
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("exports")
    .select("id, user_id, format, status, storage_path, credits_spent")
    .eq("id", exportId)
    .maybeSingle();
  if (!row || row.user_id !== user.id) throw new ApiException("NOT_FOUND", "We couldn't find that export.");

  const uploaded = await objectExists(row.storage_path);

  if (status === "failed") {
    if (row.status === "complete" || uploaded) throw new ApiException("CONFLICT", "This export was delivered.");
    const balance =
      row.status === "failed"
        ? await getBalance(user.id)
        : await addCredits({
            userId: user.id,
            amount: row.credits_spent,
            reason: `refund:export`,
            idempotencyKey: `refund:export:${user.id}:${exportId}`,
          });
    await admin.from("exports").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", exportId);
    return NextResponse.json({ balance });
  }

  if (!uploaded) throw new ApiException("UPLOAD_FAILED", "The file didn't finish uploading. Try exporting again.");

  const format = row.format as ExportFormatId;
  const filename = `flyer-${exportId.slice(0, 8)}.${EXPORT_FORMATS[format].extension}`;
  const [download, share] = await Promise.all([
    admin.storage.from("exports").createSignedUrl(row.storage_path, SHARE_SECONDS, { download: filename }),
    admin.storage.from("exports").createSignedUrl(row.storage_path, SHARE_SECONDS),
  ]);
  if (download.error || share.error) throw new Error("signed url failed");

  if (row.status !== "complete") {
    await admin.from("exports").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", exportId);
  }

  const response: ExportCompleteResponse = { downloadUrl: download.data.signedUrl, shareUrl: share.data.signedUrl, format };
  return NextResponse.json(response);
});
