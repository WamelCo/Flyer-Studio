/** Response shapes shared by API routes and the UI. */
import type { FlyerDoc, FlyerFormat } from "@/lib/canvas/types";
import type { ExportFormatId } from "@/lib/stripe/plans";

/** POST /api/generate when the job runs in the background (202). */
export interface GenerateAccepted {
  jobId: string;
  status: "pending";
  /** Balance after the charge. */
  balance: number;
}

/** GET /api/generate/[jobId]. */
export interface GenerationStatus {
  status: "pending" | "running" | "succeeded" | "failed";
  /** queued | directing | designing | composing | reviewing | saving | done (see lib/generation/pipeline.ts). */
  stage: string | null;
  result?: GenerateResponse;
  error?: { code: import("@/lib/api/types").ApiErrorCode; message: string };
  /** Balance after a failed job's refund. */
  balance?: number;
}

export interface GenerateResponse {
  jobId: string;
  projectId: string;
  format: FlyerFormat;
  /** Three composed, editable designs — one per design direction. */
  docs: FlyerDoc[];
  /** Strongest first; `score` is the creative-director review (1–10) when one ran. */
  directions: { layout: string; palette: string; type: string; score?: number }[];
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
