import { createMiddleware } from "hono/factory";

import { auth } from "./auth";
import { ApiException, type AppEnv } from "./http";

/** Verifies the caller's Better Auth session and exposes it as `c.var.user`. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new ApiException("UNAUTHORIZED", "Please sign in to continue.");
  c.set("user", { id: session.user.id, email: session.user.email });
  await next();
});
