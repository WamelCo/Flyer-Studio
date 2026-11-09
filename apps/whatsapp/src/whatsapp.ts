import { createHash } from "node:crypto";
import { log } from "@flyer/log";
import QRCode from "qrcode";
import wweb from "whatsapp-web.js";

import type { Channel, Incoming } from "./channel";

const { Client, LocalAuth, MessageMedia } = wweb;

/**
 * The studio's WhatsApp account, driven through WhatsApp Web (whatsapp-web.js + headless
 * Chromium). The session is kept under WHATSAPP_DATA_DIR, so a restart doesn't need a new
 * QR scan. This is an unofficial client: use a number dedicated to the studio.
 */

export type ConnectionState = "starting" | "qr" | "ready" | "disconnected";

export interface WhatsApp {
  state: { status: ConnectionState; qr: string | null; number: string | null };
  channel: Channel;
  /** A text to an E.164 number (sign-in codes from the web app). */
  sendToNumber(phone: string, text: string): Promise<void>;
  /** Drops the WhatsApp Web session's browser and starts it again (the saved login is kept). */
  restart(reason: string): void;
  destroy(): Promise<void>;
}

/**
 * A stable id for a message, used to answer a redelivered message once. Newer WhatsApp Web
 * builds hand whatsapp-web.js message keys without `_serialized`, so it is rebuilt from the
 * key's parts (chat + message id), with the timestamp and text as a last resort.
 */
export function messageId(message: { id?: { _serialized?: string; id?: string; remote?: unknown } | null; from: string; timestamp?: number; body?: string }) {
  const key = message.id;
  if (key?._serialized) return key._serialized;
  if (key?.id) return `${typeof key.remote === "string" ? key.remote : message.from}_${key.id}`;
  return `${message.from}_${message.timestamp ?? 0}_${createHash("sha256").update(message.body ?? "").digest("hex").slice(0, 16)}`;
}

export function startWhatsApp(onMessage: (message: Incoming) => void): WhatsApp {
  const state: WhatsApp["state"] = { status: "starting", qr: null, number: null };
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: process.env.WHATSAPP_DATA_DIR || ".wwebjs_auth" }),
    // WhatsApp Web is several MB of JavaScript: on a slow line the 30 s default isn't enough.
    authTimeoutMs: Number(process.env.WHATSAPP_AUTH_TIMEOUT_MS || 180_000),
    qrMaxRetries: 0,
    puppeteer: {
      headless: true,
      // A busy machine can keep Chrome from answering for minutes; don't give up after puppeteer's 3.
      protocolTimeout: Number(process.env.WHATSAPP_PROTOCOL_TIMEOUT_MS || 600_000),
      executablePath: process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run"],
    },
  });

  client.on("qr", async (qr) => {
    state.status = "qr";
    state.qr = qr;
    // Scan from the logs (docker compose logs -f) or the /qr page.
    console.log(`\nScan with the studio's WhatsApp (Linked devices → Link a device):\n${await QRCode.toString(qr, { type: "terminal", small: true })}`);
  });
  client.on("ready", () => {
    state.status = "ready";
    state.qr = null;
    state.number = client.info?.wid?.user ? `+${client.info.wid.user}` : null;
    log.info("whatsapp.ready", { number: state.number });
    // WHATSAPP_NUMBER is the number people are told codes come from: catch a scan with the wrong phone.
    const expected = (process.env.WHATSAPP_NUMBER ?? "").replace(/\D/g, "").replace(/^0/, process.env.DEFAULT_PHONE_COUNTRY || "263");
    if (expected && state.number && state.number.replace(/\D/g, "") !== expected) {
      log.error("whatsapp.wrong_number", { connected: state.number, expected: `+${expected}`, fix: "Log out this device on that phone, then scan the QR with the studio phone" });
    }
  });
  client.on("auth_failure", (message) => log.error("whatsapp.auth_failure", { message }));
  client.on("disconnected", (reason) => {
    state.status = "disconnected";
    log.warn("whatsapp.disconnected", { reason: String(reason) });
    // Logged out from the phone: start over, which shows a new QR code.
    setTimeout(() => void client.initialize().catch((error: unknown) => log.error("whatsapp.restart_failed", { reason: String(error) })), 10_000);
  });

  /** The sender's phone. Newer WhatsApp hides it behind a linked-device id (@lid) that we resolve. */
  async function phoneOf(from: string): Promise<string | null> {
    if (from.endsWith("@c.us")) return `+${from.split("@")[0]}`;
    if (from.endsWith("@lid")) {
      try {
        const [pair] = await client.getContactLidAndPhone([from]);
        if (pair?.pn) return `+${pair.pn.split("@")[0]}`;
      } catch {
        // fall through
      }
      try {
        const contact = await client.getContactById(from);
        if (contact.number) return `+${contact.number}`;
      } catch {
        // unknown
      }
    }
    return null;
  }

  client.on("message", async (message) => {
    if (message.fromMe || message.isStatus || message.from.endsWith("@g.us") || message.from === "status@broadcast" || message.from.endsWith("@newsletter")) return;
    onMessage({
      id: messageId(message),
      chatId: message.from,
      phone: await phoneOf(message.from),
      body: message.body ?? "",
      kind: message.type === "chat" ? "text" : message.hasMedia ? "media" : "other",
    });
  });

  const channel: Channel = {
    async sendText(chatId, text) {
      await client.sendMessage(chatId, text);
    },
    async sendImage(chatId, png, caption, filename) {
      // Uploads to WhatsApp's media servers fail on a flaky line: try again before giving up.
      const media = new MessageMedia("image/png", Buffer.from(png).toString("base64"), filename);
      for (let attempt = 1; ; attempt++) {
        try {
          await client.sendMessage(chatId, media, { caption });
          return;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (attempt >= 3 || !/upload failed|media entry|timed? ?out|network|fetch|ECONN|socket/i.test(reason)) throw error;
          log.warn("whatsapp.image_retry", { attempt, reason: reason.split("\n")[0] });
          await new Promise((r) => setTimeout(r, attempt * 5_000));
        }
      }
    },
    async typing(chatId) {
      await (await client.getChatById(chatId)).sendStateTyping();
    },
  };

  // Keep trying: a slow or dropped connection shouldn't leave the studio offline until someone restarts it.
  let attempt = 0;
  const start = () => {
    attempt += 1;
    state.status = "starting";
    client.initialize().catch(async (error: unknown) => {
      state.status = "disconnected";
      const reason = error instanceof Error ? error.message : String(error);
      const delay = Math.min(120_000, 10_000 * attempt);
      log.error("whatsapp.start_failed", {
        reason,
        attempt,
        retryInSeconds: delay / 1000,
        hint: /browser|executable|spawn|ENOENT/i.test(reason) ? "set CHROME_PATH to a Chrome/Chromium executable" : "WhatsApp Web didn't load in time — check the internet connection",
      });
      await client.destroy().catch(() => undefined);
      setTimeout(start, delay);
    });
  };
  start();

  let restarting = false;
  const restart = (reason: string) => {
    if (restarting) return;
    restarting = true;
    state.status = "disconnected";
    log.warn("whatsapp.restarting", { reason });
    void client
      .destroy()
      .catch(() => undefined)
      .finally(() => {
        restarting = false;
        attempt = 0;
        setTimeout(start, 5_000);
      });
  };

  return {
    state,
    channel,
    async sendToNumber(phone, text) {
      const id = await client.getNumberId(phone.replace(/\D/g, ""));
      if (!id) throw new Error("NOT_ON_WHATSAPP");
      await client.sendMessage(id._serialized, text);
    },
    restart,
    destroy: () => client.destroy(),
  };
}
