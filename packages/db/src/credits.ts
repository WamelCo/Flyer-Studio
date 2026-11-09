import { eq, sql } from "drizzle-orm";

import { db, pgError, query } from "./client";
import { profiles } from "./schema";

/**
 * Typed wrappers around the credit functions (migrations: deduct_credits / add_credits).
 * These are the ONLY way credits move. Idempotency keys are namespaced by the server,
 * never taken verbatim from a client.
 */

export interface CreditChange {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
}

export type DeductResult = { ok: true; balance: number } | { ok: false; balance: number };

export async function deductCredits({ userId, amount, reason, idempotencyKey }: CreditChange): Promise<DeductResult> {
  try {
    const [row] = await query<{ balance: number }>(
      sql`select public.deduct_credits(${userId}::uuid, ${amount}::integer, ${reason}, ${idempotencyKey}) as balance`,
    );
    return { ok: true, balance: Number(row!.balance) };
  } catch (error) {
    const { message } = pgError(error);
    if (message.includes("INSUFFICIENT_CREDITS")) return { ok: false, balance: await getBalance(userId) };
    throw new Error(`deduct_credits failed: ${message}`);
  }
}

export async function addCredits({ userId, amount, reason, idempotencyKey }: CreditChange): Promise<number> {
  try {
    const [row] = await query<{ balance: number }>(
      sql`select public.add_credits(${userId}::uuid, ${amount}::integer, ${reason}, ${idempotencyKey}) as balance`,
    );
    return Number(row!.balance);
  } catch (error) {
    throw new Error(`add_credits failed: ${pgError(error).message}`);
  }
}

export async function getBalance(userId: string): Promise<number> {
  const [row] = await db().select({ credits: profiles.credits }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!row) throw new Error("profile lookup failed: no profile");
  return row.credits;
}

/** The stored profile. Read plans through @flyer/billing's getProfile, which treats an ended pass as Free. */
export async function getProfileRow(userId: string) {
  const [row] = await db()
    .select({
      id: profiles.id,
      email: profiles.email,
      plan: profiles.plan,
      credits: profiles.credits,
      freeFlyers: profiles.freeFlyers,
      billingInterval: profiles.billingInterval,
      currentPeriodEnd: profiles.currentPeriodEnd,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row ?? null;
}

/** Marks a payment paid, grants its credits once (ledger key paynow:<id>) and sets the pass. */
export async function fulfilPayment(paymentId: string, paynowReference: string | null) {
  const [row] = await query<{ balance: number; plan: string; period_end: Date | string; newly_paid: boolean }>(
    sql`select * from public.fulfil_payment(${paymentId}::uuid, ${paynowReference})`,
  );
  if (!row) throw new Error("fulfil_payment returned no row");
  return { balance: Number(row.balance), plan: row.plan, periodEnd: new Date(row.period_end), newlyPaid: row.newly_paid };
}

export type FlyerCharge =
  | { ok: true; free: true; freeLeft: number; balance: number }
  | { ok: true; free: false; freeLeft: number; balance: number }
  | { ok: false; freeLeft: number; balance: number };

/**
 * Pays for one generation: a free flyer (watermarked, engine-only) or `cost` credits.
 * `preferFree`: Free-plan accounts use free flyers first (their output is watermarked either
 * way); Pro/Max use credits first and keep free flyers for later. Atomic in Postgres.
 */
export async function chargeForFlyer({ userId, jobId, cost, preferFree }: { userId: string; jobId: string; cost: number; preferFree: boolean }): Promise<FlyerCharge> {
  const tryFree = async () => Number((await query<{ left: number }>(sql`select public.use_free_flyer(${userId}::uuid) as left`))[0]?.left ?? -1);
  const tryCredits = () => deductCredits({ userId, amount: cost, reason: "generate", idempotencyKey: `generate:${userId}:${jobId}` });
  const profile = await getProfileRow(userId);
  if (!profile) throw new Error("profile lookup failed: no profile");

  if (preferFree) {
    const left = await tryFree();
    if (left >= 0) return { ok: true, free: true, freeLeft: left, balance: profile.credits };
    const charge = await tryCredits();
    return charge.ok ? { ok: true, free: false, freeLeft: 0, balance: charge.balance } : { ok: false, freeLeft: 0, balance: charge.balance };
  }
  const charge = await tryCredits();
  if (charge.ok) return { ok: true, free: false, freeLeft: profile.freeFlyers, balance: charge.balance };
  const left = await tryFree();
  return left >= 0 ? { ok: true, free: true, freeLeft: left, balance: charge.balance } : { ok: false, freeLeft: 0, balance: charge.balance };
}

/** Gives back a free flyer a failed generation used. */
export async function returnFreeFlyer(userId: string) {
  await query(sql`select public.return_free_flyer(${userId}::uuid)`);
}

/** A pass granted by the studio (support, comps, the owner): plan, period and credits, credits keyed once. */
export async function grantPass(userId: string, plan: "pro" | "max", interval: "month" | "year", credits: number, key: string) {
  const [row] = await query<{ balance: number; plan: string; period_end: Date | string }>(
    sql`select * from public.grant_pass(${userId}::uuid, ${plan}::public.plan_tier, ${interval}::public.billing_interval, ${credits}::integer, ${key})`,
  );
  return { balance: Number(row!.balance), plan: row!.plan, periodEnd: new Date(row!.period_end) };
}

/** Folds account `from` into `into` (projects, credits, passes, the phone number); `from` is deleted. */
export async function mergeAccounts(from: string, into: string) {
  await query(sql`select public.merge_accounts(${from}::uuid, ${into}::uuid)`);
}
