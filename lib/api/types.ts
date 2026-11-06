/** The one error shape every API route returns: `{ error: "CODE", message: "..." }`. */

export const API_ERROR_CODES = [
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "INSUFFICIENT_CREDITS",
  "PLAN_LOCKED",
  "GENERATION_FAILED",
  "GENERATION_BLOCKED",
  "GENERATION_TIMEOUT",
  "AI_NOT_CONFIGURED",
  "PHOTOS_NOT_CONFIGURED",
  "PHOTOS_UNAVAILABLE",
  "PAYMENTS_NOT_CONFIGURED",
  "AUTH_NOT_CONFIGURED",
  "WEBHOOK_SIGNATURE_INVALID",
  "UPLOAD_FAILED",
  "INTERNAL_ERROR",
  "NETWORK_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiErrorBody).error === "string" &&
    typeof (value as ApiErrorBody).message === "string"
  );
}
