"use client";

import type Konva from "konva";

import { ApiError, apiFetch } from "@/lib/api/client";
import type { ExportCompleteResponse, ExportStartResponse } from "@flyer/core/api/contracts";
import { loadFonts } from "@/lib/canvas/fonts";
import { renderPage } from "@/lib/canvas/render";
import type { FlyerDoc } from "@flyer/core/canvas/types";
import { preloadImages } from "@/lib/canvas/use-image";
import { EXPORT_FORMATS, exportWidth, pdfPageSize } from "@flyer/core/export/formats";
import type { ExportFormatId } from "@flyer/core/stripe/plans";
import { putToSlot } from "@/lib/storage";

export type ExportStage = "rendering" | "uploading" | "finishing";

/** Carries the post-refund balance when an export fails after it was charged. */
export class ExportError extends ApiError {
  constructor(source: ApiError, readonly refundedBalance?: number) {
    super(source.code, source.message, source.status, source.details);
  }
}

async function toPdf(png: Blob, doc: FlyerDoc, title: string) {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const size = pdfPageSize(doc);
  const page = pdf.addPage([size.width, size.height]);
  const image = await pdf.embedPng(await png.arrayBuffer());
  page.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
  pdf.setTitle(title);
  pdf.setCreator("Flyer Studio");
  return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}

interface RunExportOptions {
  page: Konva.Group;
  doc: FlyerDoc;
  projectId: string;
  title: string;
  format: ExportFormatId;
  watermark: boolean;
  onStage: (stage: ExportStage) => void;
  /** Called as soon as the server has charged, so the balance can roll down immediately. */
  onCharged: (balance: number) => void;
}

/**
 * Render locally → charge via the server RPC → upload to a signed slot → confirm.
 * Credits are only touched on the server; a failed upload is refunded.
 */
export async function runExport({ page, doc, projectId, title, format, watermark, onStage, onCharged }: RunExportOptions) {
  const spec = EXPORT_FORMATS[format];
  const exportId = crypto.randomUUID();

  onStage("rendering");
  await Promise.all([loadFonts(doc), preloadImages(doc.nodes.flatMap((node) => (node.type === "image" ? [node.src] : [])))]);
  const raster = await renderPage(page, doc, { width: exportWidth(doc, format), watermark });
  const file = spec.extension === "pdf" ? await toPdf(raster, doc, title) : raster;

  const start = await apiFetch<ExportStartResponse>("/api/export", {
    method: "POST",
    json: { exportId, projectId, format, watermarked: watermark },
  });
  onCharged(start.balance);

  try {
    onStage("uploading");
    if (!(await putToSlot(start.uploadUrl, start.uploadHeaders, file))) {
      throw new ApiError("UPLOAD_FAILED", "The upload didn't go through. Your credits were returned.", 502);
    }

    onStage("finishing");
    return await apiFetch<ExportCompleteResponse>(`/api/export/${exportId}`, { method: "POST", json: { status: "complete" } });
  } catch (caught) {
    const error = caught instanceof ApiError ? caught : new ApiError("UPLOAD_FAILED", "Export failed. Your credits were returned.", 502);
    const refund = await apiFetch<{ balance: number }>(`/api/export/${exportId}`, {
      method: "POST",
      json: { status: "failed" },
    }).catch(() => null);
    throw new ExportError(error, refund?.balance);
  }
}
