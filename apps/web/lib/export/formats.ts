import { FORMATS } from "@flyer/design/canvas/formats";
import type { FlyerDoc } from "@flyer/design/canvas/types";
import { CREDIT_COSTS, type ExportFormatId } from "@flyer/billing/plans";

export interface ExportFormat {
  id: ExportFormatId;
  label: string;
  detail: string;
  extension: "png" | "pdf" | "psd" | "svg";
  mimeType: "image/png" | "application/pdf" | "image/vnd.adobe.photoshop" | "image/svg+xml";
  /** Long edge of the rendered raster, in pixels (the PSD's canvas; unused for vector SVG). */
  longEdge: number;
  cost: number;
  /** An editable designer file (layers, live text) rather than a finished image. */
  editable?: boolean;
}

export const EXPORT_FORMATS: Record<ExportFormatId, ExportFormat> = {
  png: { id: "png", label: "PNG", detail: "Social-ready · 1080 px", extension: "png", mimeType: "image/png", longEdge: 1080, cost: CREDIT_COSTS.export.png },
  pdf: { id: "pdf", label: "PDF", detail: "Print · 300 dpi", extension: "pdf", mimeType: "application/pdf", longEdge: 3508, cost: CREDIT_COSTS.export.pdf },
  "png-2k": { id: "png-2k", label: "PNG 2K", detail: "HD · 2048 px", extension: "png", mimeType: "image/png", longEdge: 2048, cost: CREDIT_COSTS.export["png-2k"] },
  "png-4k": { id: "png-4k", label: "PNG 4K", detail: "Ultra HD · 3840 px", extension: "png", mimeType: "image/png", longEdge: 3840, cost: CREDIT_COSTS.export["png-4k"] },
  // Vector: shapes, icons and live text open as editable objects in Illustrator, Figma, Affinity and Inkscape.
  svg: { id: "svg", label: "Illustrator", detail: "SVG · vectors & live text", extension: "svg", mimeType: "image/svg+xml", longEdge: 0, cost: CREDIT_COSTS.export.svg, editable: true },
  // 2480 px long edge (A4 at ~210 dpi) keeps a layered file with a full-page photo under the 50 MB storage cap.
  psd: { id: "psd", label: "Photoshop", detail: "PSD · layers & live text", extension: "psd", mimeType: "image/vnd.adobe.photoshop", longEdge: 2480, cost: CREDIT_COSTS.export.psd, editable: true },
};

export const EXPORT_ORDER: ExportFormatId[] = ["png", "pdf", "png-2k", "png-4k", "svg", "psd"];
export const EXPORT_FORMAT_IDS = EXPORT_ORDER as [ExportFormatId, ...ExportFormatId[]];

/** Exports above this are refused by the upload route (apps/web/app/api/export/[exportId]/file). */
export const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

/** Raster width for a document at a format's resolution. */
export function exportWidth(doc: FlyerDoc, format: ExportFormatId) {
  return Math.round((doc.width * EXPORT_FORMATS[format].longEdge) / Math.max(doc.width, doc.height));
}

/** PDF page size in points: the physical size for print formats, otherwise 96 dpi → 72 pt. */
export function pdfPageSize(doc: FlyerDoc) {
  return FORMATS[doc.format].pdfPoints ?? { width: doc.width * 0.75, height: doc.height * 0.75 };
}
