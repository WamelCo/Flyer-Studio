import { serve } from "@hono/node-server";
import { closeDb } from "@flyer/db";
import { log } from "@flyer/log";

import { createBot } from "./bot";
import { createServer } from "./server";
import { startWhatsApp } from "./whatsapp";

/**
 * Flyer Studio on WhatsApp: whatsapp-web.js for the conversation, Hono for the internal API.
 * Shares the database, AI pipeline, renderer and billing with the web app (workspace packages).
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

let bot: ReturnType<typeof createBot> | null = null;
const whatsapp = startWhatsApp((message) => void bot?.handle(message));
bot = createBot({ channel: whatsapp.channel });

const port = Number(process.env.WHATSAPP_PORT || 3001);
const hostname = process.env.WHATSAPP_HOST || "127.0.0.1";
const server = serve({ fetch: createServer(whatsapp).fetch, port, hostname }, () => log.info("whatsapp.listening", { url: `http://${hostname}:${port}` }));

// whatsapp-web.js re-injects itself on page navigations without awaiting it, so a Chrome that
// stalls (a busy machine, a WhatsApp Web update) surfaces as an unhandled rejection. Restart
// the WhatsApp session instead of letting the whole service exit.
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log.error("whatsapp.unhandled_rejection", { reason: message });
  if (/Protocol error|ProtocolError|timed out|Target closed|Session closed|Execution context was destroyed/i.test(message)) whatsapp.restart(message);
});

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("whatsapp.stopping", { signal });
  server.close();
  await whatsapp.destroy().catch(() => undefined);
  await closeDb().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
