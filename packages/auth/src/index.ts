import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { emailOTP, phoneNumber } from "better-auth/plugins";
import { db, schema } from "@flyer/db";
import { check, LIMITS } from "@flyer/db/rate-limit";
import { log } from "@flyer/log";

import { sendEmailCode } from "./email";
import { sendWhatsAppText, whatsappGatewayConfigured } from "./gateway";
import { authLog } from "./logger";
import { isPhoneEmail, PHONE_EMAIL_DOMAIN, phoneDigits } from "./phone";

export { isPhoneEmail, PHONE_EMAIL_DOMAIN, normalizePhone, phoneDigits } from "./phone";
export { formatPhone, studioNumber, whatsappGatewayConfigured } from "./gateway";
export { emailConfigured } from "./email";

/**
 * Better Auth: passwordless sign-in with a 6-digit code by email (Resend) or by WhatsApp
 * (sent by apps/whatsapp). A WhatsApp sign-in for a new number creates the account; a
 * signed-in person adds their number with `phoneNumber.verify({ updatePhoneNumber: true })`,
 * which is what links WhatsApp to their account. Every new user gets a Free profile with
 * 0 credits from the database trigger on "user".
 */

export const OTP_LENGTH = 6;

async function limitCodes(recipient: string) {
  const { blocked, retryAfter } = await check(LIMITS.otp(recipient));
  if (blocked) throw new APIError("TOO_MANY_REQUESTS", { message: `Too many codes. Try again in ${Math.max(1, Math.ceil(retryAfter / 60))} min.` });
}

export function authConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.DATABASE_URL && env.BETTER_AUTH_SECRET);
}

export function createAuth({ plugins = [] }: { plugins?: BetterAuthPlugin[] } = {}) {
  return betterAuth({
    appName: "Flyer Studio",
    baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET,
    logger: { log: authLog },
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    advanced: {
      // UUIDs from Postgres (gen_random_uuid), so app tables can reference users.
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Pages read the session from a signed cookie for 5 minutes instead of the database.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      window: 60,
      max: 100,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/phone-number/send-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 10 },
        "/phone-number/verify": { window: 60, max: 10 },
      },
    },
    telemetry: { enabled: false },
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        // Codes are kept hashed, so a database leak never reveals a live one.
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }) {
          if (isPhoneEmail(email)) throw new APIError("BAD_REQUEST", { message: "Use WhatsApp to sign in to this account." });
          await limitCodes(email.toLowerCase());
          await sendEmailCode(email, otp, type);
        },
      }),
      phoneNumber({
        otpLength: OTP_LENGTH,
        expiresIn: 5 * 60,
        allowedAttempts: 5,
        phoneNumberValidator: (value) => /^\+[1-9]\d{7,14}$/.test(value),
        signUpOnVerification: {
          getTempEmail: (value) => `${phoneDigits(value)}@${PHONE_EMAIL_DOMAIN}`,
          getTempName: (value) => value,
        },
        async sendOTP({ phoneNumber: value, code }) {
          if (!whatsappGatewayConfigured()) throw new APIError("SERVICE_UNAVAILABLE", { message: "WhatsApp sign-in isn't available right now. Use email instead." });
          await limitCodes(value);
          try {
            await sendWhatsAppText(value, `${code} is your Flyer Studio code. It expires in 5 minutes. Don't share it with anyone.`);
          } catch (error) {
            log.warn("auth.whatsapp_code_failed", { reason: error instanceof Error ? error.message : String(error) });
            throw new APIError("SERVICE_UNAVAILABLE", { message: "We couldn't send a WhatsApp code just now. Check the number or use email." });
          }
        },
      }),
      ...plugins,
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
