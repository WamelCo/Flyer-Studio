/** Response shapes shared by API routes and the UI. */
import type { FlyerDoc, FlyerFormat } from "../canvas/types";
import type { BillingInterval, ExportFormatId, PlanId } from "../stripe/plans";

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
  /** True when the server can render a chosen design (POST /api/generate/:jobId/render). */
  renderable: boolean;
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
  /** Presigned R2 PUT URL, valid for a few minutes. */
  uploadUrl: string;
  /** Headers the PUT must send exactly as given (they are part of the signature). */
  uploadHeaders: Record<string, string>;
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

/** The signed-in user, as returned by GET /api/me. */
export interface MeResponse {
  id: string;
  email: string;
  plan: PlanId;
  credits: number;
}

/** GET /api/projects/:id — the project plus the stock photos its generation used. */
export interface ProjectDetail {
  id: string;
  title: string;
  format: FlyerFormat;
  canvas: unknown;
  thumbnail_url: string | null;
  updated_at: string;
  generation_id: string | null;
  artwork: string[];
}

export interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
}

/** GET /api/billing/summary */
export interface BillingSummary {
  plan: PlanId;
  credits: number;
  billingInterval: BillingInterval | null;
  currentPeriodEnd: string | null;
  ledger: LedgerEntry[];
}

export type UploadKind = "image" | "thumbnail" | "reference";

/** POST /api/uploads — a presigned slot in the public flyers bucket. */
export interface UploadSlot {
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  /** Where the object is served from once uploaded. */
  publicUrl: string;
}

/** GET /api/config/auth — which sign-in methods this server offers. */
export interface AuthConfig {
  configured: boolean;
  google: boolean;
  otpLength: number;
}

/** A finished render: the chosen design, finished by the renderer. */
export interface RenderResponse {
  /** The project's new canvas: the render as a locked full-page image. */
  doc: FlyerDoc;
  thumbnailUrl: string;
  /** Credits charged for this render (0 when included or already rendered). */
  charged: number;
  balance: number;
}

/**
 * POST /api/generate/:jobId/render starts a render (or reports one already running or
 * done); GET /api/generate/:jobId/render/:variant polls it. Renders take 15s to a few
 * minutes, so the client polls "pending" until "done".
 */
export type RenderStatus =
  | { status: "pending"; startedAt: string; charged: number; balance: number }
  | ({ status: "done" } & RenderResponse);

/**
 * One revision of a rendered flyer (POST /api/projects/:id/revisions starts it, GET
 * …/revisions/:revisionId polls it). `targets` names the elements the edit was confined
 * to; empty means the instruction named none, so the whole image could change.
 */
export interface RevisionSummary {
  id: string;
  instruction: string;
  status: "pending" | "done" | "failed";
  targets: string[];
  sourceUrl: string;
  resultUrl: string | null;
  charged: number;
  createdAt: string;
}

export type RevisionStatus =
  | ({ status: "pending" } & RevisionSummary & { balance: number })
  | ({ status: "done" } & RevisionSummary & { doc: FlyerDoc; balance: number });

export interface RevisionListResponse {
  revisions: RevisionSummary[];
}
