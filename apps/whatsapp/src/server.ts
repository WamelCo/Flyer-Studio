import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import QRCode from "qrcode";

import type { WhatsApp } from "./whatsapp";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The service's HTTP side (Hono). Internal: the web app sends sign-in codes through
 * /internal/send with INTERNAL_API_SECRET. Admin: /qr shows the code to connect the
 * studio's WhatsApp (?token=WHATSAPP_ADMIN_TOKEN). Only /health is unauthenticated.
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
    if (!adminToken || !same(token, adminToken)) return c.text("Not found", 404);
    const { status, qr, number } = whatsapp.state;
    const body =
      status === "ready"
        ? `<p>Connected as <b>${number ?? "the studio number"}</b>.</p>`
        : qr
          ? `<p>On the studio phone: WhatsApp → Linked devices → Link a device, then scan:</p>${await QRCode.toString(qr, { type: "svg", margin: 2, width: 320 })}`
          : `<p>Starting WhatsApp (${status})…</p>`;
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>Flyer Studio · WhatsApp</title><style>body{font-family:system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 16px;color:#1d1d1f;background:#fff}svg{width:100%;height:auto}</style></head><body><h1>WhatsApp</h1>${body}</body></html>`,
    );
  });

  return app;
}
