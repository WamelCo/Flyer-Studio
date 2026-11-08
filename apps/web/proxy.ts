import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/projects", "/billing", "/editor"];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Route protection (Next 16's name for middleware). An optimistic check: no session
 * cookie means straight to /login. Pages still verify the session with the API
 * (`requireViewer`), so a stale cookie only costs one extra round trip.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isProtectedPath(pathname) && !getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = new URLSearchParams({ next: `${pathname}${search}` }).toString();
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/projects/:path*", "/billing/:path*", "/editor/:path*"],
};
