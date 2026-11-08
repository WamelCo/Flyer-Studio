import { prisma } from "@flyer/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { randomUUID } from "node:crypto";

import { webUrl } from "./env";
import { sendSignInCode } from "./mail";

/** Length of the emailed sign-in code (6–10 digits). The web app reads it from /api/config/auth. */
export const OTP_LENGTH = Math.min(10, Math.max(6, Number(process.env.AUTH_OTP_LENGTH) || 6));

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Better Auth. The browser reaches it on the web origin (Next rewrites /api/* here), so
 * baseURL is the public web URL and cookies are first-party. Sign-in is passwordless:
 * an emailed code, or Google when configured.
 */
export const auth = betterAuth({
  appName: "Flyer Studio",
  baseURL: webUrl(),
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [webUrl()],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  socialProviders: googleConfigured()
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          prompt: "select_account",
        },
      }
    : {},
  plugins: [
    emailOTP({
      otpLength: OTP_LENGTH,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      async sendVerificationOTP({ email, otp }) {
        await sendSignInCode(email, otp);
      },
    }),
  ],
  advanced: {
    database: { generateId: () => randomUUID() },
  },
  databaseHooks: {
    user: {
      create: {
        // Every new account gets a Free profile with 0 credits.
        async after(user) {
          await prisma.profile.upsert({
            where: { id: user.id },
            update: {},
            create: { id: user.id, email: user.email },
          });
        },
      },
    },
  },
});
