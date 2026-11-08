import type { ApiErrorBody, ApiErrorCode } from "@flyer/core/api/types";
import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

export interface ApiUser {
  id: string;
  email: string;
}

export interface AppEnv {
  Variables: { user: ApiUser };
}

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_CREDITS: 402,
  PLAN_LOCKED: 403,
  GENERATION_FAILED: 502,
  GENERATION_BLOCKED: 422,
  GENERATION_TIMEOUT: 504,
  AI_NOT_CONFIGURED: 503,
  PHOTOS_NOT_CONFIGURED: 503,
  PHOTOS_UNAVAILABLE: 502,
  PAYMENTS_NOT_CONFIGURED: 503,
  AUTH_NOT_CONFIGURED: 503,
  WEBHOOK_SIGNATURE_INVALID: 400,
  UPLOAD_FAILED: 502,
  INTERNAL_ERROR: 500,
  NETWORK_ERROR: 503,
};

/** Throw from any route to return a typed `{ error, message }` response. */
export class ApiException extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function apiError(c: Context, code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
  const body: ApiErrorBody = details ? { error: code, message, details } : { error: code, message };
  return c.json(body, STATUS[code]);
}

/** Every failure path produces `{ error, message }`, never an HTML error page. */
export const onError: ErrorHandler = (error, c) => {
  if (error instanceof ApiException) return apiError(c, error.code, error.message, error.details);
  if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
    return apiError(c, "UPLOAD_FAILED", "File storage isn't configured on this server yet.");
  }
  console.error("[api] unhandled error", error);
  return apiError(c, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
};

export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiException("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiException("VALIDATION_ERROR", issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request.");
  }
  return result.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path ids are UUID columns: anything else can't exist, so it's a 404 rather than a DB error. */
export function uuidParam(value: string, notFound: string) {
  if (!UUID.test(value)) throw new ApiException("NOT_FOUND", notFound);
  return value;
}
