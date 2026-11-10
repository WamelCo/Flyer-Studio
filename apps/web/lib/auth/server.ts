import { authConfigured, createAuth, type Auth } from "@flyer/auth";
import { isDatabaseUnavailable } from "@flyer/db";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";

let instance: Auth | null = null;

/** The Better Auth instance (created on first use, so builds don't need a database). */
export function auth(): Auth {
  // nextCookies lets server actions and route handlers set the session cookie.
  return (instance ??= createAuth({ plugins: [nextCookies()] }));
}

/** The database behind sign-in can't be reached (stopped, restarting, unreachable). */
export class AuthUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("AUTH_UNAVAILABLE", options);
    this.name = "AuthUnavailableError";
  }
}

/**
 * The signed-in session for this request, or null. Throws AuthUnavailableError when the
 * database is down — callers tell "signed out" from "can't check right now".
 */
export async function getSession() {
  const requestHeaders = await headers();
  if (!authConfigured()) return null;
  try {
    return await auth().api.getSession({ headers: requestHeaders });
  } catch (error) {
    if (isDatabaseUnavailable(error)) throw new AuthUnavailableError({ cause: error });
    throw error;
  }
}
