"use client";

import type Konva from "konva";

import { ApiError, apiFetch } from "@/lib/api/client";
import type { ExportCompleteResponse, ExportStartResponse } from "@/lib/api/contracts";
import { loadFonts } from "@/lib/canvas/fonts";
import { renderPage } from "@/lib/canvas/render";
import type { FlyerDoc } from "@flyer/design/canvas/types";
import { preloadImages } from "@/lib/canvas/use-image";
import { EXPORT_FORMATS, exportWidth, MAX_EXPORT_BYTES, pdfPageSize } from "@/lib/export/formats";
import type { ExportFormatId } from "@flyer/billing/plans";

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

async function renderFile(page: Konva.Group, doc: FlyerDoc, format: ExportFormatId, title: string, watermark: boolean): Promise<Blob> {
  const spec = EXPORT_FORMATS[format];
  // Editable designer files are paid-only (the server enforces it), so they carry no watermark.
  if (spec.extension === "svg") return (await import("@/lib/export/designer")).svgFile(doc, title);
  if (spec.extension === "psd") return (await import("@/lib/export/designer")).psdFile(page, doc, exportWidth(doc, format));
  const raster = await renderPage(page, doc, { width: exportWidth(doc, format), watermark });
  return spec.extension === "pdf" ? toPdf(raster, doc, title) : raster;
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
 * Render locally → charge on the server → upload through the app to private storage → confirm.
 * Credits are only touched on the server; a failed upload is refunded.
 */
export async function runExport({ page, doc, projectId, title, format, watermark, onStage, onCharged }: RunExportOptions) {
  const spec = EXPORT_FORMATS[format];
  const exportId = crypto.randomUUID();

  onStage("rendering");
  await Promise.all([loadFonts(doc), preloadImages(doc.nodes.flatMap((node) => (node.type === "image" ? [node.src] : [])))]);
  const file = await renderFile(page, doc, format, title, watermark);
  // Checked before charging: storage would refuse the upload anyway.
  if (file.size > MAX_EXPORT_BYTES) {
    throw new ApiError("VALIDATION_ERROR", `This ${spec.label} file is ${Math.round(file.size / 1048576)} MB — over the 50 MB limit. Try PNG 4K or PDF.`, 413);
  }

  const start = await apiFetch<ExportStartResponse>("/api/export", {
    method: "POST",
    json: { exportId, projectId, format, watermarked: watermark },
  });
  onCharged(start.balance);

  try {
    onStage("uploading");
    await apiFetch(start.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": spec.mimeType } }).catch((error: unknown) => {
      throw error instanceof ApiError && error.code !== "NETWORK_ERROR" ? error : new ApiError("UPLOAD_FAILED", "The upload didn't go through. Your credits were returned.", 502);
    });

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
