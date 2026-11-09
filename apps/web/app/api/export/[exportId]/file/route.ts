import { and, db, eq, exports } from "@flyer/db";
import { putObject } from "@flyer/storage";
import { NextResponse } from "next/server";

import { ApiException, handle, requireUser } from "@/lib/api/server";
import { EXPORT_FORMATS, MAX_EXPORT_BYTES } from "@/lib/export/formats";
import type { ExportFormatId } from "@flyer/billing/plans";
import { readBody } from "@/lib/uploads";

export const runtime = "nodejs";

/** The first bytes each export format must start with. */
function looksRight(extension: string, bytes: Uint8Array) {
  const head = new TextDecoder().decode(bytes.slice(0, 256));
  if (extension === "png") return bytes[0] === 0x89 && head.slice(1, 4) === "PNG";
  if (extension === "pdf") return head.startsWith("%PDF-");
  if (extension === "psd") return head.startsWith("8BPS");
  if (extension === "svg") return /<svg[\s>]/.test(head) || head.trimStart().startsWith("<?xml");
  return false;
}

/** The rendered export file for a paid-for export (body: the file), stored privately. */
export const PUT = handle(async (request: Request, { params }: RouteContext<"/api/export/[exportId]/file">) => {
  const user = await requireUser();
  const { exportId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new ApiException("NOT_FOUND", "We couldn't find that export.");
  const [row] = await db()
    .select({ format: exports.format, status: exports.status, storagePath: exports.storagePath })
    .from(exports)
    .where(and(eq(exports.id, exportId), eq(exports.userId, user.id)))
    .limit(1);
  if (!row) throw new ApiException("NOT_FOUND", "We couldn't find that export.");
  if (row.status !== "pending") throw new ApiException("CONFLICT", "This export is already finished.");

  const spec = EXPORT_FORMATS[row.format as ExportFormatId];
  const bytes = await readBody(request, MAX_EXPORT_BYTES);
  if (!looksRight(spec.extension, bytes)) throw new ApiException("VALIDATION_ERROR", `That isn't a ${spec.label} file.`);
  await putObject("private", row.storagePath, bytes, { contentType: spec.mimeType });
  return NextResponse.json({ uploaded: true });
});
