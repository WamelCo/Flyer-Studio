/** Response shapes shared by API routes and the UI. */
import type { FlyerFormat } from "@flyer/design/canvas/types";
import type { ExportFormatId } from "@flyer/billing/plans";
import type { DesignResult } from "@flyer/ai/pipeline";

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

/** A finished generation (@flyer/ai) plus the balance after it. */
export type GenerateResponse = DesignResult & { balance: number };

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
  /** PUT the rendered file here (same origin; the server stores it privately). */
  uploadUrl: string;
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
