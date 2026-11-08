import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";

import { auth } from "./auth";
import { apiError, onError, type AppEnv } from "./http";
import { billing, checkout } from "./routes/billing";
import { exportsRoute } from "./routes/exports";
import { generate } from "./routes/generate";
import { config, me, photos } from "./routes/misc";
import { projects } from "./routes/projects";
import { uploads } from "./routes/uploads";
import { webhooks } from "./routes/webhooks";

/**
 * Every route lives under /api. In the browser it's reached on the web origin — Next.js
 * rewrites /api/* to this server — so session cookies are first-party and no CORS is needed.
 */
export const app = new Hono<AppEnv>()
  .use(logger())
  // Canvas JSON is the largest body we accept; files go straight to R2.
  .use("/api/*", bodyLimit({ maxSize: 5 * 1024 * 1024, onError: (c) => apiError(c, "VALIDATION_ERROR", "Request body is too large.") }))
  .get("/health", (c) => c.json({ ok: true }))
  .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  .route("/api/config", config)
  .route("/api/me", me)
  .route("/api/projects", projects)
  .route("/api/generate", generate)
  .route("/api/export", exportsRoute)
  .route("/api/uploads", uploads)
  .route("/api/photos", photos)
  .route("/api/checkout", checkout)
  .route("/api/billing", billing)
  .route("/api/webhooks", webhooks)
  .notFound((c) => apiError(c, "NOT_FOUND", "No such endpoint."))
  .onError(onError);

export type AppType = typeof app;
