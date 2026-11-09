import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy } from "@/lib/security-headers";

const PROTECTED_PREFIXES = ["/dashboard", "/projects", "/billing", "/editor", "/whatsapp"];

export function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Next 16's middleware ("proxy"). Sends signed-out visitors of app routes to sign-in — an
 * optimistic check on the session cookie only; every page and API route verifies the
 * session itself — and sets the Content-Security-Policy, which depends on runtime
 * configuration (the storage origin), so it can't be baked in at build time.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  let response: NextResponse;
  if (isProtectedPath(pathname) && !getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = new URLSearchParams({ next: `${pathname}${search}` }).toString();
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next();
  }
  response.headers.set("Content-Security-Policy", contentSecurityPolicy());
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, image optimisation, auth endpoints and webhooks (Paynow's result URL).
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
