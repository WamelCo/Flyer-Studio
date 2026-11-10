import { spawn } from "node:child_process";
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

const port = Number(process.env.WHATSAPP_PORT || 3001);
const hostname = process.env.WHATSAPP_HOST || "127.0.0.1";
const development = process.env.NODE_ENV !== "production";
const qrPage = `http://localhost:${port}/qr`;

/** The default browser, for the QR page (development on this machine). */
function openInBrowser(url: string) {
  const [command, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
      .on("error", () => undefined)
      .unref();
  } catch {
    // No browser to open (a server, CI): the link is in the log.
  }
}

let bot: ReturnType<typeof createBot> | null = null;
const whatsapp = startWhatsApp((message) => void bot?.handle(message), {
  // Development: a big scannable QR in the browser, not one squeezed into the terminal.
  terminalQr: !development,
  onQr() {
    if (!development) return;
    console.log(`\nLink the studio phone: ${qrPage} — WhatsApp → Linked devices → Link a device, then scan.\n`);
    if (process.env.WHATSAPP_OPEN_QR !== "0") openInBrowser(qrPage);
  },
});
bot = createBot({ channel: whatsapp.channel });
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
