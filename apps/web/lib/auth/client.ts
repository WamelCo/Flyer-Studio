"use client";

import { emailOTPClient, phoneNumberClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Same length as the server's codes (@flyer/auth OTP_LENGTH). */
export const OTP_LENGTH = 6;

function make() {
  return createAuthClient({ baseURL: window.location.origin, plugins: [emailOTPClient(), phoneNumberClient()] });
}

let client: ReturnType<typeof make> | null = null;

/** Better Auth's browser client (sign-in codes by email or WhatsApp). Browser only. */
export function authClient() {
  return (client ??= make());
}

/** A readable message from a Better Auth error response. */
export function authErrorMessage(error: { status?: number; message?: string; code?: string } | null | undefined, fallback: string) {
  if (!error) return fallback;
  if (error.status === 429) return error.message && /try again/i.test(error.message) ? error.message : "Too many attempts. Wait a minute, then try again.";
  if (error.code === "INVALID_OTP" || error.code === "OTP_EXPIRED" || /otp|code/i.test(error.code ?? "")) return "That code didn't match or has expired. Try again or request a new one.";
  if (error.code === "TOO_MANY_ATTEMPTS") return "Too many wrong codes. Request a new one.";
  if (error.code === "PHONE_NUMBER_EXIST") return "That WhatsApp number is already linked to another account.";
  // Our own 503s explain themselves; a bare 500 means the server (usually its database) is having trouble.
  if (error.status === 503 && error.message) return error.message;
  if (error.status && error.status >= 500) return "Sign-in is having trouble on our side. Try again in a moment.";
  return error.message || fallback;
}
