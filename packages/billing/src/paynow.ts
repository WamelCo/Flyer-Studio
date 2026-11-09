import { createHash } from "node:crypto";

/**
 * Paynow Zimbabwe (https://developers.paynow.co.zw). Server only.
 *
 * Every message is form-encoded and signed: the values (not the keys), in message order,
 * URL-decoded, run together, with the integration key appended — SHA512, upper-case hex.
 * Verified against both worked examples in Paynow's docs (scripts/test-paynow.mts).
 *
 *   PAYNOW_INTEGRATION_ID / PAYNOW_INTEGRATION_KEY  required
 *   PAYNOW_TEST_AUTH_EMAIL  while the integration is in test mode: the merchant account's
 *                           email (Paynow only completes test payments for that address)
 *   PAYNOW_BASE_URL         tests only (a mock server)
 */

export interface PaynowConfig {
  id: string;
  key: string;
  base: string;
  testAuthEmail: string | null;
}

export function paynowConfig(env: NodeJS.ProcessEnv = process.env): PaynowConfig | null {
  const id = env.PAYNOW_INTEGRATION_ID?.trim();
  const key = env.PAYNOW_INTEGRATION_KEY?.trim();
  if (!id || !key) return null;
  return { id, key, base: (env.PAYNOW_BASE_URL?.trim() || "https://www.paynow.co.zw").replace(/\/+$/, ""), testAuthEmail: env.PAYNOW_TEST_AUTH_EMAIL?.trim() || null };
}

export function paynowHash(values: string[], key: string) {
  return createHash("sha512").update(values.join("") + key, "utf8").digest("hex").toUpperCase();
}

/** A form-encoded message as ordered [key, value] pairs (keys lower-cased, values decoded). */
export function parseMessage(body: string): [string, string][] {
  return [...new URLSearchParams(body.trim())].map(([k, v]) => [k.toLowerCase(), v]);
}

/** True when the message carries a hash and it matches its other values, in order. */
export function verifyMessage(pairs: [string, string][], key: string) {
  const hash = pairs.find(([k]) => k === "hash")?.[1];
  if (!hash) return false;
  const expected = paynowHash(pairs.filter(([k]) => k !== "hash").map(([, v]) => v), key);
  // Constant-time-ish: equal length strings compared in full.
  return hash.length === expected.length && [...hash.toUpperCase()].every((c, i) => c === expected[i]);
}

const field = (pairs: [string, string][], name: string) => pairs.find(([k]) => k === name)?.[1] ?? null;

/** Paynow's transaction statuses, as our three outcomes. */
export function outcomeOf(status: string | null): "paid" | "failed" | "pending" {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "paid" || s === "awaiting delivery" || s === "delivered") return "paid";
  if (s === "cancelled" || s === "failed" || s === "disputed" || s === "refunded") return "failed";
  return "pending";
}

async function post(url: string, body: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  return response.text();
}

export type InitiateResult = { ok: true; browserUrl: string; pollUrl: string } | { ok: false; error: string };

/** Starts a web (redirect) transaction: Paynow's page takes EcoCash, OneMoney, InnBucks, ZimSwitch and cards. */
export async function initiateTransaction(
  config: PaynowConfig,
  payment: { reference: string; amount: number; info: string; returnUrl: string; resultUrl: string; authEmail: string | null },
): Promise<InitiateResult> {
  const fields: [string, string][] = [
    ["id", config.id],
    ["reference", payment.reference],
    ["amount", payment.amount.toFixed(2)],
    ["additionalinfo", payment.info],
    ["returnurl", payment.returnUrl],
    ["resulturl", payment.resultUrl],
  ];
  const authEmail = config.testAuthEmail ?? payment.authEmail;
  if (authEmail) fields.push(["authemail", authEmail]);
  fields.push(["status", "Message"]);
  fields.push(["hash", paynowHash(fields.map(([, v]) => v), config.key)]);

  let text: string;
  try {
    text = await post(`${config.base}/interface/initiatetransaction`, new URLSearchParams(fields).toString());
  } catch (error) {
    return { ok: false, error: `Paynow unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
  const pairs = parseMessage(text);
  const status = field(pairs, "status")?.toLowerCase();
  if (status !== "ok") return { ok: false, error: field(pairs, "error") ?? `Unexpected reply from Paynow (${text.slice(0, 120)})` };
  // Paynow's own advice: never redirect to a browser URL whose message fails the hash.
  if (!verifyMessage(pairs, config.key)) return { ok: false, error: "Paynow reply failed its signature check" };
  const browserUrl = field(pairs, "browserurl");
  const pollUrl = field(pairs, "pollurl");
  if (!browserUrl || !pollUrl) return { ok: false, error: "Paynow reply had no payment page" };
  return { ok: true, browserUrl, pollUrl };
}

export type StatusResult =
  | { ok: true; outcome: "paid" | "failed" | "pending"; status: string; reference: string | null; paynowReference: string | null; amount: number | null }
  | { ok: false; error: string };

/** Reads a status message (a result-URL notification or a poll reply) and verifies it. */
export function readStatus(body: string, key: string): StatusResult {
  const pairs = parseMessage(body);
  if (!verifyMessage(pairs, key)) return { ok: false, error: "signature check failed" };
  const status = field(pairs, "status") ?? "";
  const amount = Number(field(pairs, "amount"));
  return {
    ok: true,
    outcome: outcomeOf(status),
    status,
    reference: field(pairs, "reference"),
    paynowReference: field(pairs, "paynowreference"),
    amount: Number.isFinite(amount) ? amount : null,
  };
}

/** Asks Paynow for a transaction's status. Only Paynow's own host is ever polled. */
export async function pollTransaction(config: PaynowConfig, pollUrl: string): Promise<StatusResult> {
  let host: string;
  try {
    host = new URL(pollUrl).host;
  } catch {
    return { ok: false, error: "invalid poll URL" };
  }
  const allowed = [new URL(config.base).host, "www.paynow.co.zw", "paynow.co.zw", "staging.paynow.co.zw"];
  if (!allowed.includes(host)) return { ok: false, error: `poll URL host ${host} is not Paynow` };
  try {
    return readStatus(await post(pollUrl, ""), config.key);
  } catch (error) {
    return { ok: false, error: `Paynow unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
