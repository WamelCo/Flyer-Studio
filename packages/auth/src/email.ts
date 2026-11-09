import { log } from "@flyer/log";

/**
 * Sign-in codes by email through Resend's HTTP API (RESEND_API_KEY, EMAIL_FROM). In
 * development without a key the code is printed to the server log instead, so sign-in
 * works offline; in production a missing key is an error.
 */

export function emailConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

const SUBJECTS: Record<string, string> = {
  "sign-in": "Your Flyer Studio sign-in code",
  "email-verification": "Confirm your email for Flyer Studio",
  "change-email": "Confirm your new email for Flyer Studio",
  "forget-password": "Your Flyer Studio code",
};

function html(code: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 16px">
<table role="presentation" width="100%" style="max-width:440px;background:#fff;border-radius:18px;padding:40px 32px">
<tr><td style="font-size:17px;font-weight:600;padding-bottom:24px">Flyer Studio</td></tr>
<tr><td style="font-size:15px;line-height:1.5;color:#424245;padding-bottom:16px">Enter this code to sign in. It expires in 10 minutes.</td></tr>
<tr><td style="font-size:34px;font-weight:700;letter-spacing:8px;padding-bottom:24px">${code}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#86868b">If you didn&rsquo;t ask for this code, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendEmailCode(email: string, code: string, type: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV !== "production") {
      // Development only: no email service, so show the code where the developer can see it.
      console.log(`\n  Sign-in code for ${email}: ${code}   (set RESEND_API_KEY and EMAIL_FROM to email it)\n`);
      return;
    }
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: SUBJECTS[type] ?? SUBJECTS["sign-in"],
      html: html(code),
      text: `Your Flyer Studio code is ${code}. It expires in 10 minutes.`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    log.error("auth.email_failed", { status: response.status, body: (await response.text()).slice(0, 200) });
    throw new Error("EMAIL_SEND_FAILED");
  }
}
