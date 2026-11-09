import { authConfigured, createAuth, type Auth } from "@flyer/auth";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";

let instance: Auth | null = null;

/** The Better Auth instance (created on first use, so builds don't need a database). */
export function auth(): Auth {
  // nextCookies lets server actions and route handlers set the session cookie.
  return (instance ??= createAuth({ plugins: [nextCookies()] }));
}

/** The signed-in session for this request, or null. */
export async function getSession() {
  const requestHeaders = await headers();
  if (!authConfigured()) return null;
  return auth().api.getSession({ headers: requestHeaders });
}
