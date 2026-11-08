import "server-only";

import { isApiErrorBody } from "@flyer/core/api/types";
import { headers } from "next/headers";

import { ApiError } from "@/lib/api/client";
import { apiUrl } from "@/lib/env";

/**
 * Calls the Hono API from a Server Component, forwarding the visitor's cookies so the
 * request runs as them. Never cached: every response is per-user.
 */
export async function serverApi<T>(path: string, init?: RequestInit): Promise<T> {
  const incoming = await headers();
  const forwarded = new Headers(init?.headers);
  for (const name of ["cookie", "user-agent", "x-forwarded-for"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}${path}`, { ...init, cache: "no-store", headers: forwarded });
  } catch {
    throw new ApiError("NETWORK_ERROR", "The API is unreachable. Is it running?", 503);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isApiErrorBody(body)) throw new ApiError(body.error, body.message, response.status, body.details);
    throw new ApiError("INTERNAL_ERROR", "Something went wrong. Please try again.", response.status);
  }
  return body as T;
}
