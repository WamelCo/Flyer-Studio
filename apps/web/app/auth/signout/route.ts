import { NextResponse, type NextRequest } from "next/server";

import { apiUrl } from "@/lib/env";

/**
 * The sidebar's sign-out form posts here (works without JavaScript). Ends the Better
 * Auth session on the API and passes its cookie-clearing headers back to the browser.
 */
export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const response = NextResponse.redirect(new URL("/", origin), { status: 303 });

  try {
    const result = await fetch(`${apiUrl()}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        // Better Auth's CSRF check: the request must come from a trusted origin.
        origin,
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });
    for (const cookie of result.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
  } catch {
    // API unreachable: still drop the session cookies locally.
  }

  for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token"]) {
    if (!response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${name}=`))) {
      response.cookies.set(name, "", { maxAge: 0, path: "/" });
    }
  }
  return response;
}
