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

export interface StartOptions {
  /** A linking round starts: the first QR code since starting, being linked or logged out. */
  onQr?: () => void;
  /** Print each QR in the log as text (the container's logs); development links through /qr instead. */
  terminalQr?: boolean;
}

export function startWhatsApp(onMessage: (message: Incoming) => void, options: StartOptions = {}): WhatsApp {
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
    // WhatsApp rotates the code every ~20 s: only the first one starts a linking round.
    const firstOfRound = state.status !== "qr";
    state.status = "qr";
    state.qr = qr;
    if (firstOfRound) options.onQr?.();
    // Scan from the logs (docker compose logs -f) or the /qr page.
    if (options.terminalQr ?? true) {
      console.log(`\nScan with the studio's WhatsApp (Linked devices → Link a device):\n${await QRCode.toString(qr, { type: "terminal", small: true })}`);
    }
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

  /** A call into WhatsApp Web that gives up after `ms` instead of hanging (a stalled page can take minutes). */
  const within = <T,>(promise: Promise<T>, ms: number, what: string) =>
    Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))]);

  /** The sender's phone. Newer WhatsApp hides it behind a linked-device id (@lid) that we resolve. */
  async function phoneOf(message: { from: string; getContact(): Promise<{ number?: string }> }): Promise<string | null> {
    const from = message.from;
    if (from.endsWith("@c.us")) return `+${from.split("@")[0]}`;
    if (from.endsWith("@lid")) {
      try {
        const [pair] = await within(client.getContactLidAndPhone([from]), 15_000, "getContactLidAndPhone");
        if (pair?.pn) return `+${pair.pn.split("@")[0]}`;
      } catch (error) {
        log.warn("whatsapp.lid_lookup_failed", { step: "lid_and_phone", reason: error instanceof Error ? error.message : String(error) });
      }
      try {
        const contact = await within(message.getContact(), 15_000, "getContact");
        if (contact.number && /^\d{8,15}$/.test(contact.number)) return `+${contact.number}`;
      } catch (error) {
        log.warn("whatsapp.lid_lookup_failed", { step: "contact", reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return null;
  }

  type WebMessage = wweb.Message;

  /**
   * Messages that arrived while the service was down or deaf don't come back as new events.
   * On every connect, answer the unread ones from the last 6 hours (at most 5 per chat); the
   * bot's message-id table makes sure nothing is answered twice.
   */
  async function catchUp() {
    const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
    if (!client.pupPage) return;
    let unread: unknown[];
    try {
      // whatsapp-web.js's getChats() builds a full model for every chat and fails on current
      // WhatsApp Web, so read the chat store directly: unread 1:1 chats, their last few messages.
      unread = await within(
        client.pupPage.evaluate(() => {
          const page = window as unknown as {
            require(name: string): { Chat: { getModelsArray(): { id?: { server?: string }; unreadCount?: number; msgs?: { getModelsArray(): { id?: { fromMe?: boolean } }[] } }[] } };
            WWebJS: { getMessageModel(message: unknown): unknown };
          };
          const found: unknown[] = [];
          for (const chat of page.require("WAWebCollections").Chat.getModelsArray()) {
            const server = chat.id?.server;
            const count = chat.unreadCount ?? 0;
            if ((server !== "c.us" && server !== "lid") || count <= 0) continue;
            for (const message of (chat.msgs?.getModelsArray() ?? []).slice(-Math.min(count, 5))) {
              if (message.id?.fromMe) continue;
              try {
                found.push(page.WWebJS.getMessageModel(message));
              } catch {
                // a message WhatsApp Web can't describe: skip it
              }
            }
          }
          return found;
        }),
        60_000,
        "reading unread chats",
      );
    } catch (error) {
      log.warn("whatsapp.catch_up_failed", { reason: describe(error) });
      return;
    }
    const MessageClass = (wweb as unknown as { Message: new (client: unknown, data: unknown) => wweb.Message }).Message;
    let handled = 0;
    for (const data of unread) {
      try {
        const message = new MessageClass(client, data);
        if (Date.now() / 1000 - message.timestamp > 6 * 3600) continue;
        await incoming(message);
        handled += 1;
      } catch (error) {
        log.warn("whatsapp.catch_up_message_failed", { reason: describe(error) });
      }
    }
    log.info("whatsapp.caught_up", { unread: unread.length, handled });
  }
  client.on("ready", () => setTimeout(() => void catchUp(), 5_000));

  client.on("message", (message) => void incoming(message));

  async function incoming(message: WebMessage) {
    if (message.fromMe || message.isStatus || message.from.endsWith("@g.us") || message.from === "status@broadcast" || message.from.endsWith("@newsletter")) return;
    // Logged before anything can go wrong, so "nothing happened" is always visible in the log.
    log.info("whatsapp.received", { chat: message.from.split("@")[1], type: message.type });
    const phone = await phoneOf(message);
    if (!phone) log.warn("whatsapp.number_unresolved", { chat: message.from.split("@")[1] });
    onMessage({
      id: messageId(message),
      chatId: message.from,
      phone,
      body: message.body ?? "",
      kind: message.type === "chat" ? "text" : message.hasMedia ? "media" : "other",
    });
  }

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

  // Watchdog. A WhatsApp Web load that stalls part-way (a busy machine, a slow line) can report
  // "ready" without the hook that hands incoming messages to us — every message is then dropped
  // silently. Every two minutes, check the hook is there and the page answers; if not, reconnect.
  const watchdog = setInterval(async () => {
    if (state.status !== "ready" || restarting || !client.pupPage) return;
    try {
      const hooked = await within(
        client.pupPage.evaluate(() => {
          const page = window as unknown as { onAddMessageEvent?: unknown; WWebJS?: { getMessageModel?: unknown } };
          return typeof page.onAddMessageEvent === "function" && typeof page.WWebJS?.getMessageModel === "function";
        }),
        30_000,
        "health check",
      );
      if (!hooked) restart("incoming-message hook missing");
    } catch (error) {
      restart(`health check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 120_000);
  watchdog.unref?.();

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
