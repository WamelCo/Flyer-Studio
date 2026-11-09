import { and, db, eq, sql, user } from "@flyer/db";

import { PHONE_EMAIL_DOMAIN, phoneDigits } from "./phone";

/**
 * The account for a WhatsApp number — created on the spot if the number is new (a message
 * from a number proves it, so it is stored as verified). The number is the account's key:
 * no name, email or password. The database trigger gives a new number its welcome flyers.
 * A later web sign-in with a WhatsApp code finds this same account (Better Auth looks users
 * up by phone number); an email account that links the number absorbs it (merge_accounts).
 */
export async function phoneAccount(phone: string): Promise<{ id: string; email: string; created: boolean }> {
  const find = async () =>
    (
      await db()
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(and(eq(user.phoneNumber, phone), eq(user.phoneNumberVerified, true)))
        .limit(1)
    )[0];

  const existing = await find();
  if (existing) return { ...existing, created: false };

  // A number typed somewhere but never verified doesn't own it: this message does.
  await db()
    .update(user)
    .set({ phoneNumber: null, updatedAt: sql`now()` })
    .where(and(eq(user.phoneNumber, phone), eq(user.phoneNumberVerified, false)));

  const email = `${phoneDigits(phone)}@${PHONE_EMAIL_DOMAIN}`;
  const [created] = await db()
    .insert(user)
    .values({ name: phone, email, emailVerified: false, phoneNumber: phone, phoneNumberVerified: true })
    .onConflictDoNothing()
    .returning({ id: user.id, email: user.email });
  if (created) return { ...created, created: true };

  // Two first messages at once: the other one created it.
  const raced = await find();
  if (!raced) throw new Error(`could not create an account for ${phone}`);
  return { ...raced, created: false };
}
