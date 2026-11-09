import { authConfigured } from "@flyer/auth";

import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** Better Auth's endpoints: sign-in codes (email, WhatsApp), sessions, sign-out. */
async function handler(request: Request) {
  if (!authConfigured()) {
    return Response.json({ code: "AUTH_NOT_CONFIGURED", message: "Sign-in isn't configured on this server yet." }, { status: 503 });
  }
  return auth().handler(request);
}

export const GET = handler;
export const POST = handler;
