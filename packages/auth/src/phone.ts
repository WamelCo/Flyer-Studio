/** Accounts created by a WhatsApp sign-in get a placeholder email on this reserved domain. */
export const PHONE_EMAIL_DOMAIN = "phone.flyerstudio.invalid";

export function isPhoneEmail(email: string | null | undefined) {
  return Boolean(email?.toLowerCase().endsWith(`@${PHONE_EMAIL_DOMAIN}`));
}

export function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * E.164 (+263771234567) from what people type: spaces, dashes, a leading 00, or a local
 * number with a leading 0 (read with `defaultCountry`, Zimbabwe's 263 unless set).
 * Returns null when it can't be a phone number.
 */
export function normalizePhone(input: string, defaultCountry = process.env.DEFAULT_PHONE_COUNTRY || "263"): string | null {
  const raw = input.trim();
  let digits = phoneDigits(raw);
  if (raw.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = `${defaultCountry}${digits.slice(1)}`;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}
