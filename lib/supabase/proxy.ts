import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/db/types";
import { supabaseEnv } from "@/lib/env";

const PROTECTED_PREFIXES = ["/dashboard", "/projects", "/billing", "/editor"];

export function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectTo(request: NextRequest, pathname: string, params: Record<string, string>, carry: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = new URLSearchParams(params).toString();
  const response = NextResponse.redirect(url);
  // Keep any refreshed auth cookies on the redirect.
  for (const cookie of carry.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

/** Refreshes the Supabase session cookie and guards app routes. */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const env = supabaseEnv();

  if (!env) {
    return isProtectedPath(pathname)
      ? redirectTo(request, "/login", { error: "not_configured" }, NextResponse.next())
      : NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between createServerClient and getClaims — it refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && isProtectedPath(pathname)) {
    return redirectTo(request, "/login", { next: `${pathname}${search}` }, response);
  }

  if (signedIn && pathname === "/login") {
    const next = request.nextUrl.searchParams.get("next");
    return redirectTo(request, next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard", {}, response);
  }

  return response;
}
