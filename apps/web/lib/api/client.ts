import { isApiErrorBody, type ApiErrorCode } from "@flyer/core/api/types";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** fetch() for our API: resolves with JSON or throws an ApiError carrying the server's code. */
export async function apiFetch<T>(input: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let response: Response;
  try {
    response = await fetch(input, {
      ...rest,
      headers: json === undefined ? rest.headers : { "Content-Type": "application/json", ...rest.headers },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "You appear to be offline. Check your connection and try again.", 0);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isApiErrorBody(body)) throw new ApiError(body.error, body.message, response.status, body.details);
    throw new ApiError("INTERNAL_ERROR", "Something went wrong. Please try again.", response.status);
  }
  return body as T;
}
