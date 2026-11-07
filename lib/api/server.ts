import { NextResponse } from "next/server";
import type { z } from "zod";

import type { ApiErrorBody, ApiErrorCode } from "@/lib/api/types";
import { reportError } from "@/lib/monitoring";
import { createClient } from "@/lib/supabase/server";

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_CREDITS: 402,
  PLAN_LOCKED: 403,
  GENERATION_FAILED: 502,
  GENERATION_BLOCKED: 422,
  GENERATION_TIMEOUT: 504,
  RATE_LIMITED: 429,
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

/** Throw from anywhere inside `handle()` to return a typed error response. */
export class ApiException extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function apiError(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
  const body: ApiErrorBody = details ? { error: code, message, details } : { error: code, message };
  // Rate limits tell well-behaved clients when to come back.
  const retryAfter = typeof details?.retryAfter === "number" ? { "Retry-After": String(Math.ceil(details.retryAfter)) } : undefined;
  return NextResponse.json(body, { status: STATUS[code], headers: retryAfter });
}

/** Wraps a route handler so every failure path produces `{ error, message }`. */
export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiException) return apiError(error.code, error.message, error.details);
      if (error instanceof Error && error.message === "SUPABASE_NOT_CONFIGURED") {
        return apiError("AUTH_NOT_CONFIGURED", "Supabase is not configured on this server.");
      }
      console.error("[api] unhandled error", error);
      reportError(error);
      return apiError("INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
    }
  };
}

export interface ApiUser {
  id: string;
  email: string;
}

/** Verifies the caller's session (JWT signature checked by Supabase). */
export async function requireUser(): Promise<ApiUser> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) throw new ApiException("UNAUTHORIZED", "Please sign in to continue.");
  return { id: sub, email: typeof data.claims.email === "string" ? data.claims.email : "" };
}

export async function parseJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiException("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiException(
      "VALIDATION_ERROR",
      issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request.",
    );
  }
  return result.data;
}
