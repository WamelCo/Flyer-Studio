import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Typed wrappers around the credit RPCs. These are the ONLY way credits move.
 * Idempotency keys must be namespaced by the server (never taken verbatim from a client).
 */

interface CreditChange {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
}

export type DeductResult = { ok: true; balance: number } | { ok: false; balance: number };

export async function deductCredits({ userId, amount, reason, idempotencyKey }: CreditChange): Promise<DeductResult> {
  const { data, error } = await createAdminClient().rpc("deduct_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    if (error.message.includes("INSUFFICIENT_CREDITS")) return { ok: false, balance: await getBalance(userId) };
    throw new Error(`deduct_credits failed: ${error.message}`);
  }
  return { ok: true, balance: data };
}

export async function addCredits({ userId, amount, reason, idempotencyKey }: CreditChange): Promise<number> {
  const { data, error } = await createAdminClient().rpc("add_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`add_credits failed: ${error.message}`);
  return data;
}

export async function getBalance(userId: string): Promise<number> {
  const { data, error } = await createAdminClient().from("profiles").select("credits").eq("id", userId).single();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  return data.credits;
}

export async function getProfile(userId: string) {
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, email, plan, credits, stripe_customer_id, stripe_subscription_id, billing_interval, current_period_end")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  return data;
}
