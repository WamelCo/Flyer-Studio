import { log } from "@flyer/log";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sign-in codes by email, through whichever sender is configured:
 *   Resend   RESEND_API_KEY + EMAIL_FROM (needs a domain verified in Resend)
 *   SMTP     SMTP_HOST + SMTP_USER + SMTP_PASS (Gmail with an app password, Zoho, your host…)
 * In development with neither, the code is printed to the server log instead, so sign-in
 * works offline; in production that is an error.
 */

function smtpConfigured(env: NodeJS.ProcessEnv) {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

export function emailConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean((env.RESEND_API_KEY && env.EMAIL_FROM) || smtpConfigured(env));
}

let transport: { key: string; transporter: Transporter } | null = null;
function smtp(env: NodeJS.ProcessEnv) {
  const port = Number(env.SMTP_PORT || 465);
  const key = `${env.SMTP_HOST}:${port}:${env.SMTP_USER}`;
  if (transport?.key !== key) {
    transport = {
      key,
      transporter: nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        // 465 is TLS from the start; 587 upgrades with STARTTLS.
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
        // Gmail shows app passwords in groups of four ("abcd efgh …"): the spaces aren't part of it.
        auth: { user: env.SMTP_USER, pass: (env.SMTP_PASS ?? "").replace(/\s+/g, "") },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return transport.transporter;
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

export async function sendEmailCode(email: string, code: string, type: string, env: NodeJS.ProcessEnv = process.env) {
  const subject = SUBJECTS[type] ?? SUBJECTS["sign-in"]!;
  const text = `Your Flyer Studio code is ${code}. It expires in 10 minutes.`;

  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject, html: html(code), text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      log.error("auth.email_failed", { via: "resend", status: response.status, body: (await response.text()).slice(0, 200) });
      throw new Error("EMAIL_SEND_FAILED");
    }
    return;
  }

  if (smtpConfigured(env)) {
    try {
      await smtp(env).sendMail({ from: env.EMAIL_FROM || `Flyer Studio <${env.SMTP_USER}>`, to: email, subject, html: html(code), text });
    } catch (error) {
      // Never log the password: nodemailer's message names the server and the reason only.
      log.error("auth.email_failed", { via: "smtp", host: env.SMTP_HOST, reason: error instanceof Error ? error.message : String(error) });
      throw new Error("EMAIL_SEND_FAILED");
    }
    return;
  }

  if (env.NODE_ENV !== "production") {
    // Development only: no email service, so show the code where the developer can see it.
    console.log(`\n  Sign-in code for ${email}: ${code}   (set SMTP_* or RESEND_API_KEY + EMAIL_FROM to email it)\n`);
    return;
  }
  throw new Error("EMAIL_NOT_CONFIGURED");
}
