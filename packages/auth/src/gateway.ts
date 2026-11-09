/**
 * The web app's line to apps/whatsapp (Hono + whatsapp-web.js), which owns the WhatsApp
 * session: sign-in codes and notices are sent through its internal API. Both sides share
 * INTERNAL_API_SECRET; the WhatsApp service is only reachable inside the Compose network.
 */

export function whatsappGatewayConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.WHATSAPP_SERVICE_URL && env.INTERNAL_API_SECRET);
}

/** The studio's WhatsApp number (WHATSAPP_NUMBER), as E.164 — shown so people know who is messaging them. */
export function studioNumber(env: NodeJS.ProcessEnv = process.env) {
  const digits = (env.WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  // A local number (0717…) is read in DEFAULT_PHONE_COUNTRY, like everywhere else.
  return digits.startsWith("0") ? `+${env.DEFAULT_PHONE_COUNTRY || "263"}${digits.slice(1)}` : `+${digits}`;
}

/** +263717726626 → "+263 71 772 6626" (Zimbabwe grouping; other countries as +digits). */
export function formatPhone(e164: string) {
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("263") && d.length === 12) return `+263 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return `+${d}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.WHATSAPP_SERVICE_URL?.replace(/\/$/, "");
  const secret = process.env.INTERNAL_API_SECRET;
  if (!base || !secret) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `WhatsApp service HTTP ${response.status}`);
  return body;
}

/** Sends a text to an E.164 number from the studio's WhatsApp account. */
export async function sendWhatsAppText(to: string, text: string) {
  await call<{ ok: true }>("/internal/send", { method: "POST", body: JSON.stringify({ to, text }) });
}

export interface WhatsAppStatus {
  state: "starting" | "qr" | "ready" | "disconnected";
  /** The studio's own number (E.164) once connected. */
  number: string | null;
}

export async function whatsappStatus(): Promise<WhatsAppStatus | null> {
  if (!whatsappGatewayConfigured()) return null;
  try {
    return await call<WhatsAppStatus>("/internal/status");
  } catch {
    return null;
  }
}
