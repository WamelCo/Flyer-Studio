"use client";

import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Better Auth in the browser. Same-origin: /api/auth/* is rewritten to the Hono API. */
export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
});
