import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseJson, requireUser } from "@/lib/api/server";
import { startPayment } from "@flyer/billing/payments";
import { enforce, LIMITS } from "@/lib/rate-limit";

const Body = z.object({
  plan: z.enum(["pro", "max"]),
  interval: z.enum(["month", "year"]),
});

/**
 * Starts a Paynow payment for a pass and returns Paynow's payment page. The price comes
 * from lib/billing/plans.ts, never from the client. Paynow returns the customer to
 * /billing?payment=<id>, where the status is confirmed.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  await enforce(LIMITS.checkout(user.id), "Too many payment attempts — wait a moment and try again.");
  const { plan, interval } = await parseJson(request, Body);
  const { paymentId, redirectUrl } = await startPayment({ id: user.id, email: user.email || null }, plan, interval);
  return NextResponse.json({ paymentId, redirectUrl });
});
