/** How the bot talks to WhatsApp — whatsapp-web.js in production, a recorder in tests. */
export interface Channel {
  sendText(chatId: string, text: string): Promise<void>;
  sendImage(chatId: string, png: Uint8Array, caption: string, filename: string): Promise<void>;
  /** Shows "typing…" while a flyer is being designed (best effort). */
  typing?(chatId: string): Promise<void>;
}

/** One incoming message, already filtered (no groups, statuses or our own messages). */
export interface Incoming {
  /** WhatsApp's message id — the same message delivered twice is handled once. */
  id: string;
  /** Where replies go (a phone or a linked-device id). */
  chatId: string;
  /** The sender's number in E.164, or null when WhatsApp hides it. */
  phone: string | null;
  body: string;
  kind: "text" | "media" | "other";
}
