import { prisma } from "./client";

/**
 * Typed wrappers around the credit SQL functions. These are the ONLY way credits move.
 * Idempotency keys must be namespaced by the server (never taken verbatim from a client).
 */

export interface CreditChange {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
}

export type DeductResult = { ok: true; balance: number } | { ok: false; balance: number };

function isInsufficient(error: unknown) {
  return error instanceof Error && error.message.includes("INSUFFICIENT_CREDITS");
}

export async function deductCredits({ userId, amount, reason, idempotencyKey }: CreditChange): Promise<DeductResult> {
  try {
    const [row] = await prisma.$queryRaw<{ balance: number }[]>`
      select deduct_credits(${userId}, ${amount}::integer, ${reason}, ${idempotencyKey}) as balance`;
    return { ok: true, balance: row!.balance };
  } catch (error) {
    if (isInsufficient(error)) return { ok: false, balance: await getBalance(userId) };
    throw new Error(`deduct_credits failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function addCredits({ userId, amount, reason, idempotencyKey }: CreditChange): Promise<number> {
  const [row] = await prisma.$queryRaw<{ balance: number }[]>`
    select add_credits(${userId}, ${amount}::integer, ${reason}, ${idempotencyKey}) as balance`;
  return row!.balance;
}

export async function getBalance(userId: string): Promise<number> {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: userId }, select: { credits: true } });
  return profile.credits;
}

/** The caller's profile; created on the spot for an account that predates the signup hook. */
export async function getProfile(userId: string, email = "") {
  return prisma.profile.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email },
  });
}

/** Deletes Free-plan projects untouched for 30 days. Returns how many went. */
export async function purgeExpiredFreeProjects(): Promise<number> {
  const [row] = await prisma.$queryRaw<{ deleted: number }[]>`select purge_expired_free_projects() as deleted`;
  return row?.deleted ?? 0;
}
