import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { db, eq, verification } from "@flyer/db";

import { ApiException } from "@/lib/api/server";

/**
 * Six-digit codes that prove a signed-in person owns a WhatsApp number or an email address
 * before it is attached to their account (and any account behind it merged in). One pending
 * code per account and kind; stored hashed; 5 minutes; 5 attempts.
 */

export type LinkKind = "whatsapp" | "email";

const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const identifier = (kind: LinkKind, userId: string) => `${kind}-link:${userId}`;
const digest = (userId: string, target: string, code: string) =>
  createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(`${userId}:${target}:${code}`).digest("hex");

/** A new code for `target` (a phone number or an email); the caller sends it. */
export async function issueLinkCode(kind: LinkKind, userId: string, target: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db().delete(verification).where(eq(verification.identifier, identifier(kind, userId)));
  await db()
    .insert(verification)
    .values({ identifier: identifier(kind, userId), value: JSON.stringify({ target, hash: digest(userId, target, code), attempts: 0 }), expiresAt: new Date(Date.now() + TTL_MS) });
  return code;
}

/** The target the code was sent to, once the code matches (it can't be used again). */
export async function checkLinkCode(kind: LinkKind, userId: string, code: string): Promise<string> {
  const [row] = await db().select().from(verification).where(eq(verification.identifier, identifier(kind, userId))).limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) throw new ApiException("VALIDATION_ERROR", "That code has expired. Request a new one.");

  const pending = JSON.parse(row.value) as { target: string; hash: string; attempts: number };
  const expected = Buffer.from(pending.hash, "hex");
  const given = Buffer.from(digest(userId, pending.target, code), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) await db().delete(verification).where(eq(verification.id, row.id));
    else await db().update(verification).set({ value: JSON.stringify({ ...pending, attempts }) }).where(eq(verification.id, row.id));
    throw new ApiException("VALIDATION_ERROR", attempts >= MAX_ATTEMPTS ? "Too many wrong codes. Request a new one." : "That code didn't match. Try again.");
  }
  await db().delete(verification).where(eq(verification.id, row.id));
  return pending.target;
}
