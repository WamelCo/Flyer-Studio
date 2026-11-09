/**
 * Gives an account a Pro or Max pass without a payment (the owner, support, comps). Same
 * rules as a paid pass: the plan's credits for the period land once, and renewing the same
 * active plan extends it.
 *   pnpm admin:grant-pass <phone or email> <pro|max> [month|year]
 * Reads DATABASE_URL from the repo's .env.local (in the container: set it in the environment).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { closeDb, db, eq, grantPass, or, user } from "@flyer/db";

import { creditsForPass, PLANS, type PaidPlanId } from "../src/plans";

const envFile = resolve(import.meta.dirname, "../../../.env.local");
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const [who, planArg, intervalArg = "month"] = process.argv.slice(2);
if (!who || (planArg !== "pro" && planArg !== "max") || (intervalArg !== "month" && intervalArg !== "year")) {
  console.log("Usage: pnpm admin:grant-pass <phone or email> <pro|max> [month|year]");
  process.exit(1);
}
const plan = planArg as PaidPlanId;
const interval = intervalArg as "month" | "year";

// A phone in any common form: +263 77…, 263…, 077… (read in DEFAULT_PHONE_COUNTRY, Zimbabwe by default).
const digits = who.replace(/\D/g, "");
const phone = who.includes("@") ? null : `+${digits.startsWith("0") ? `${process.env.DEFAULT_PHONE_COUNTRY || "263"}${digits.slice(1)}` : digits}`;

const [account] = await db()
  .select({ id: user.id, email: user.email, phone: user.phoneNumber })
  .from(user)
  .where(phone ? eq(user.phoneNumber, phone) : or(eq(user.email, who.toLowerCase()), eq(user.email, who)))
  .limit(1);
if (!account) {
  console.log(`No account for ${who}.`);
  await closeDb();
  process.exit(1);
}

const credits = creditsForPass(plan, interval);
const result = await grantPass(account.id, plan, interval, credits, `grant:${account.id}:${randomUUID()}`);
console.log(`${PLANS[plan].name} pass (${interval === "year" ? "12 months" : "1 month"}) granted to ${account.phone ?? account.email}: active until ${result.periodEnd.toDateString()}, balance ${result.balance} credits.`);
await closeDb();
