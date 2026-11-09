import { authConfigured } from "@flyer/auth";
import { headers } from "next/headers";

import { auth } from "@/lib/auth/server";

/**
 * Sign-out form target: ends the session, clears its cookies, then goes home. The redirect
 * is relative: behind a proxy (or in the container, bound to 0.0.0.0) the server's own
 * origin isn't the one the browser used, and the CSP's form-action would block it.
 */
export async function POST() {
  const response = new Response(null, { status: 303, headers: { Location: "/" } });
  if (authConfigured()) {
    const result = await auth()
      .api.signOut({ headers: await headers(), asResponse: true })
      .catch(() => null);
    for (const cookie of result?.headers.getSetCookie() ?? []) response.headers.append("Set-Cookie", cookie);
  }
  return response;
}
