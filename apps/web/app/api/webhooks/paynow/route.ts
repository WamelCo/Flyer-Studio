import { NextResponse } from "next/server";

import { paynowConfig, readStatus } from "@flyer/billing/paynow";
import { refreshPayment } from "@flyer/billing/payments";
import { log } from "@flyer/log";

/**
 * Paynow's result URL: a signed status update whenever a payment changes. The signature is
 * checked, then the payment is confirmed by polling Paynow (Paynow's advice for important
 * updates) before anything is granted. Paynow retries up to ten times on an error reply,
 * so failures here answer 500 and success answers 200.
 */
export async function POST(request: Request) {
  const config = paynowConfig();
  if (!config) return NextResponse.json({ error: "PAYMENTS_NOT_CONFIGURED" }, { status: 503 });
  const status = readStatus(await request.text(), config.key);
  if (!status.ok) {
    log.warn("paynow.result_rejected", { reason: status.error });
    return NextResponse.json({ error: "WEBHOOK_SIGNATURE_INVALID" }, { status: 400 });
  }
  if (!status.reference || !/^[0-9a-f-]{36}$/i.test(status.reference)) return NextResponse.json({ ok: true });
  try {
    const payment = await refreshPayment(status.reference);
    log.info("paynow.result", { payment: status.reference, reported: status.status, now: payment?.status ?? "unknown" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("paynow.result_failed", { payment: status.reference, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
