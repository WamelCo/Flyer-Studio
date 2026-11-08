import { serve } from "@hono/node-server";

import { app } from "./app";
import { scheduleRetention } from "./jobs/retention";

const port = Number(process.env.PORT) || 4000;

const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, (info) => {
  console.log(`Flyer Studio API listening on http://localhost:${info.port}`);
});

scheduleRetention();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
