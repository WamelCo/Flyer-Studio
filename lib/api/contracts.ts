/** Response shapes shared by API routes and the UI. */
import type { FlyerDoc, FlyerFormat } from "@/lib/canvas/types";
import type { ExportFormatId } from "@/lib/stripe/plans";

export interface GenerateResponse {
  jobId: string;
  projectId: string;
  format: FlyerFormat;
  /** Three composed, editable designs — one per design direction. */
  docs: FlyerDoc[];
  directions: { layout: string; palette: string; type: string }[];
  /** The art director's reasoning (colour psychology, type voice, layout). */
  rationale: string;
  /** Who art-directed: Claude, an open-weight model (see lib/design/open-model.ts) or the built-in rules. */
  source: "claude" | "open-model" | "rules";
  /** Unsplash download-tracking URLs for the photos placed in each design. */
  photoDownloads: string[][];
  balance: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  format: FlyerFormat;
  thumbnailUrl: string | null;
  updatedAt: string;
}

export interface SaveProjectResponse {
  revision: number;
  updatedAt: string;
}

export interface ExportStartResponse {
  exportId: string;
  path: string;
  uploadToken: string;
  watermark: boolean;
  balance: number;
  /** True when this exportId was already paid for (a retry). */
  replay: boolean;
}

export interface ExportCompleteResponse {
  downloadUrl: string;
  shareUrl: string;
  format: ExportFormatId;
}
