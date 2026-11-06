/**
 * Length of the email sign-in code. Must match Supabase → Authentication → Providers →
 * Email → "Email OTP Length" (hosted projects default to 8; supabase/config.toml sets 8).
 */
export const OTP_LENGTH = Math.min(10, Math.max(6, Number(process.env.NEXT_PUBLIC_AUTH_OTP_LENGTH) || 8));
