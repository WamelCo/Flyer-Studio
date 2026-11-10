import { timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import QRCode from "qrcode";

import type { WhatsApp } from "./whatsapp";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Development, asked from this machine, by a localhost address: the QR page opens without the
 * admin token, so linking is one click from the link the service opens. The Host check stops
 * a web page from reaching it through a domain that resolves to 127.0.0.1 (DNS rebinding);
 * production — the container — always needs the token.
 */
function onThisMachine(c: Context, env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === "production" || !LOCAL_HOST.test(c.req.header("host") ?? "")) return false;
  try {
    return LOOPBACK.has(getConnInfo(c).remote.address ?? "");
  } catch {
    return false;
  }
}

/**
 * The service's HTTP side (Hono). Internal: the web app sends sign-in codes through
 * /internal/send with INTERNAL_API_SECRET. Admin: /qr shows the code to connect the
 * studio's WhatsApp (?token=WHATSAPP_ADMIN_TOKEN; no token in development on this machine).
 * Only /health is unauthenticated.
 */
export function createServer(whatsapp: Pick<WhatsApp, "state" | "sendToNumber">, env: NodeJS.ProcessEnv = process.env) {
  const app = new Hono();
  const secret = env.INTERNAL_API_SECRET ?? "";
  const adminToken = env.WHATSAPP_ADMIN_TOKEN || secret;

  app.get("/health", (c) => c.json({ ok: true, whatsapp: whatsapp.state.status }));

  const internal = new Hono();
  internal.use("*", async (c, next) => {
    if (!secret) return c.json({ error: "INTERNAL_API_SECRET is not set" }, 503);
    return bearerAuth({ token: secret })(c, next);
  });
  internal.get("/status", (c) => c.json({ state: whatsapp.state.status, number: whatsapp.state.number }));
  internal.post("/send", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { to?: unknown; text?: unknown } | null;
    const to = typeof body?.to === "string" ? body.to : "";
    const text = typeof body?.text === "string" ? body.text : "";
    if (!/^\+[1-9]\d{7,14}$/.test(to) || !text || text.length > 2000) return c.json({ error: "Send { to: E.164 number, text }" }, 400);
    if (whatsapp.state.status !== "ready") return c.json({ error: "WhatsApp isn't connected" }, 503);
    try {
      await whatsapp.sendToNumber(to, text);
      return c.json({ ok: true });
    } catch (error) {
      const notOnWhatsApp = error instanceof Error && error.message === "NOT_ON_WHATSAPP";
      return c.json({ error: notOnWhatsApp ? "That number isn't on WhatsApp" : "Sending failed" }, notOnWhatsApp ? 404 : 502);
    }
  });
  app.route("/internal", internal);

  app.get("/qr", async (c) => {
    const token = c.req.query("token") ?? "";
    if (!onThisMachine(c, env) && (!adminToken || !same(token, adminToken))) return c.text("Not found", 404);
    const { status, qr, number } = whatsapp.state;
    const ready = status === "ready";
    const body = ready
      ? `<p class="ok">Linked ✓ Connected as <b>${number ?? "the studio number"}</b>.</p><p>WhatsApp sign-in codes and the bot are live. You can close this tab.</p>`
      : qr
        ? `<p>On the studio phone, open <b>WhatsApp → Linked devices → Link a device</b> and scan:</p>${await QRCode.toString(qr, { type: "svg", margin: 2, width: 320 })}<p class="hint">The code changes every few seconds — this page keeps up by itself.</p>`
        : `<p>Starting WhatsApp${status === "disconnected" ? " again" : ""}… the code appears here in a moment.</p>`;
    // Until it's linked the page follows the QR (WhatsApp rotates it every ~20 s); the QR links
    // the studio's account to whoever scans it, so it is never cached.
    c.header("Cache-Control", "no-store");
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${ready ? "" : `<meta http-equiv="refresh" content="${qr ? 8 : 3}">`}<title>Flyer Studio · Link WhatsApp</title><style>body{font-family:system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 16px;color:#1d1d1f;background:#fff;line-height:1.45}svg{width:100%;height:auto}.hint{color:#6e6e73;font-size:14px}.ok{color:#1a7f37;font-size:18px}</style></head><body><h1>Link WhatsApp</h1>${body}</body></html>`,
    );
  });

  return app;
}
