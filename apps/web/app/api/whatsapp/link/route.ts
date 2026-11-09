import { isPhoneEmail, normalizePhone, whatsappGatewayConfigured } from "@flyer/auth";
import { sendWhatsAppText } from "@flyer/auth/gateway";
import { db, eq, mergeAccounts, user as users, whatsappChats } from "@flyer/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { checkLinkCode, issueLinkCode } from "@/lib/link-codes";
import { enforce, LIMITS } from "@/lib/rate-limit";

/**
 * Linking a WhatsApp number to the signed-in (email) account. WhatsApp-first means the number
 * may already be an account of its own — created by the bot on its first message. Proving the
 * number (a code sent to it) then folds that account into this one: its flyers, credits, free
 * flyers and pass come along, and the bot keeps working with the same number.
 *
 *   POST   { phone }  sends a 6-digit code to the number
 *   PUT    { code }   checks it, then links (or merges) the number
 *   DELETE            unlinks the number (accounts that also have an email only)
 */

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const { phone: raw } = await parseJson(request, z.object({ phone: z.string().min(6).max(32) }));
  const phone = normalizePhone(raw);
  if (!phone) throw new ApiException("VALIDATION_ERROR", "Enter your WhatsApp number with its country code, e.g. +263 77 123 4567.");
  if (user.phone) throw new ApiException("CONFLICT", "This account already has a WhatsApp number.");
  if (!whatsappGatewayConfigured()) throw new ApiException("AUTH_NOT_CONFIGURED", "WhatsApp isn't available right now.");
  await enforce(LIMITS.otp(phone), "Too many codes for this number. Try again in a few minutes.");

  const code = await issueLinkCode("whatsapp", user.id, phone);
  try {
    await sendWhatsAppText(phone, `${code} is your Flyer Studio code to link this WhatsApp number to your account. It expires in 5 minutes. Don't share it with anyone.`);
  } catch {
    throw new ApiException("UPLOAD_FAILED", "We couldn't send a WhatsApp code to that number. Check it and try again.");
  }
  return NextResponse.json({ sent: true, phone });
});

export const PUT = handle(async (request: Request) => {
  const user = await requireUser();
  const { code } = await parseJson(request, z.object({ code: z.string().regex(/^\d{6}$/) }));
  const phone = await checkLinkCode("whatsapp", user.id, code);

  const [owner] = await db().select({ id: users.id, email: users.email }).from(users).where(eq(users.phoneNumber, phone)).limit(1);
  let merged = false;
  if (!owner || owner.id === user.id) {
    // A new number for this account (the database trigger gives a never-seen number its welcome flyers).
    await db().update(users).set({ phoneNumber: phone, phoneNumberVerified: true, updatedAt: new Date() }).where(eq(users.id, user.id));
  } else if (isPhoneEmail(owner.email)) {
    // The number's WhatsApp account joins this one.
    await mergeAccounts(owner.id, user.id);
    merged = true;
  } else {
    throw new ApiException("CONFLICT", "That number is already linked to another Flyer Studio account that signs in with email.");
  }
  return NextResponse.json({ linked: true, phone, merged });
});

export const DELETE = handle(async () => {
  const user = await requireUser();
  if (!user.email) throw new ApiException("CONFLICT", "This account signs in with WhatsApp, so its number can't be removed.");
  if (user.phone) await db().delete(whatsappChats).where(eq(whatsappChats.phone, user.phone));
  await db().update(users).set({ phoneNumber: null, phoneNumberVerified: false, updatedAt: new Date() }).where(eq(users.id, user.id));
  return NextResponse.json({ unlinked: true });
});
