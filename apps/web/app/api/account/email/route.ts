import { emailConfigured, isPhoneEmail } from "@flyer/auth";
import { sendEmailCode } from "@flyer/auth/email";
import { db, eq, mergeAccounts, sql, user as users } from "@flyer/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { checkLinkCode, issueLinkCode } from "@/lib/link-codes";
import { enforce, LIMITS } from "@/lib/rate-limit";

/**
 * Adding an email to an account made with a WhatsApp number, so it can sign in either way.
 * If that email already has its own (email-only) account — someone who signed up on the web
 * first — proving the address with a code folds that account into this one.
 *
 *   POST { email }  sends a 6-digit code to the address
 *   PUT  { code }   checks it, then adds (or merges) the email
 */

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const { email: raw } = await parseJson(request, z.object({ email: z.string().trim().email().max(254) }));
  const email = raw.toLowerCase();
  if (isPhoneEmail(email)) throw new ApiException("VALIDATION_ERROR", "Use a real email address.");
  if (user.email) throw new ApiException("CONFLICT", "This account already has an email.");
  if (!emailConfigured() && process.env.NODE_ENV === "production") throw new ApiException("AUTH_NOT_CONFIGURED", "Email isn't available right now.");
  await enforce(LIMITS.otp(email), "Too many codes for this address. Try again in a few minutes.");

  const code = await issueLinkCode("email", user.id, email);
  try {
    await sendEmailCode(email, code, "change-email");
  } catch {
    throw new ApiException("UPLOAD_FAILED", "We couldn't send an email to that address. Check it and try again.");
  }
  return NextResponse.json({ sent: true, email });
});

export const PUT = handle(async (request: Request) => {
  const user = await requireUser();
  const { code } = await parseJson(request, z.object({ code: z.string().regex(/^\d{6}$/) }));
  const email = await checkLinkCode("email", user.id, code);

  const [owner] = await db()
    .select({ id: users.id, phone: users.phoneNumber, phoneVerified: users.phoneNumberVerified })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);
  let merged = false;
  if (owner && owner.id !== user.id) {
    if (owner.phone && owner.phoneVerified) {
      throw new ApiException("CONFLICT", "That email belongs to another Flyer Studio account with its own WhatsApp number.");
    }
    // The email's web account joins this one (it frees the address as it goes).
    await mergeAccounts(owner.id, user.id);
    merged = true;
  }
  await db().update(users).set({ email, emailVerified: true, updatedAt: new Date() }).where(eq(users.id, user.id));
  return NextResponse.json({ added: true, email, merged });
});
