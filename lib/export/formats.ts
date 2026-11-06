import { FORMATS } from "@/lib/canvas/formats";
import type { FlyerDoc } from "@/lib/canvas/types";
import { CREDIT_COSTS, type ExportFormatId } from "@/lib/stripe/plans";

export interface ExportFormat {
  id: ExportFormatId;
  label: string;
  detail: string;
  extension: "png" | "pdf";
  mimeType: "image/png" | "application/pdf";
  /** Long edge of the rendered raster, in pixels. */
  longEdge: number;
  cost: number;
}

export const EXPORT_FORMATS: Record<ExportFormatId, ExportFormat> = {
  png: { id: "png", label: "PNG", detail: "Social-ready · 1080 px", extension: "png", mimeType: "image/png", longEdge: 1080, cost: CREDIT_COSTS.export.png },
  pdf: { id: "pdf", label: "PDF", detail: "Print · 300 dpi", extension: "pdf", mimeType: "application/pdf", longEdge: 3508, cost: CREDIT_COSTS.export.pdf },
  "png-2k": { id: "png-2k", label: "PNG 2K", detail: "HD · 2048 px", extension: "png", mimeType: "image/png", longEdge: 2048, cost: CREDIT_COSTS.export["png-2k"] },
  "png-4k": { id: "png-4k", label: "PNG 4K", detail: "Ultra HD · 3840 px", extension: "png", mimeType: "image/png", longEdge: 3840, cost: CREDIT_COSTS.export["png-4k"] },
};

export const EXPORT_ORDER: ExportFormatId[] = ["png", "pdf", "png-2k", "png-4k"];

/** Raster width for a document at a format's resolution. */
export function exportWidth(doc: FlyerDoc, format: ExportFormatId) {
  return Math.round((doc.width * EXPORT_FORMATS[format].longEdge) / Math.max(doc.width, doc.height));
}

/** PDF page size in points: the physical size for print formats, otherwise 96 dpi → 72 pt. */
export function pdfPageSize(doc: FlyerDoc) {
  return FORMATS[doc.format].pdfPoints ?? { width: doc.width * 0.75, height: doc.height * 0.75 };
}
