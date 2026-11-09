import { NextResponse } from "next/server";
import type { z } from "zod";

import type { ApiErrorBody, ApiErrorCode } from "@/lib/api/types";
import { reportError } from "@/lib/monitoring";
import { isPhoneEmail } from "@flyer/auth";
import { BillingError } from "@flyer/billing/payments";
import { StorageError } from "@flyer/storage";

import { getSession } from "@/lib/auth/server";

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
  PAYMENT_FAILED: 502,
  AUTH_NOT_CONFIGURED: 503,
  STORAGE_NOT_CONFIGURED: 503,
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
      if (error instanceof BillingError) return apiError(error.code, error.message, error.details);
      if (error instanceof Error && error.message === "DATABASE_NOT_CONFIGURED") {
        return apiError("AUTH_NOT_CONFIGURED", "The database is not configured on this server (DATABASE_URL).");
      }
      if (error instanceof StorageError && error.message === "STORAGE_NOT_CONFIGURED") {
        return apiError("STORAGE_NOT_CONFIGURED", "File storage is not configured on this server (STORAGE_*).");
      }
      console.error("[api] unhandled error", error);
      reportError(error);
      return apiError("INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
    }
  };
}

export interface ApiUser {
  id: string;
  /** Empty for WhatsApp-only accounts. */
  email: string;
  phone: string | null;
}

/** The signed-in caller (Better Auth session cookie, checked against the database). */
export async function requireUser(): Promise<ApiUser> {
  const session = await getSession();
  if (!session) throw new ApiException("UNAUTHORIZED", "Please sign in to continue.");
  const { user } = session;
  return {
    id: user.id,
    email: isPhoneEmail(user.email) ? "" : user.email,
    phone: (user as { phoneNumber?: string | null }).phoneNumber ?? null,
  };
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
