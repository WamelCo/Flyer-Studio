import nodemailer, { type Transporter } from "nodemailer";

import { isProduction } from "./env";

let transport: Transporter | null = null;

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 is implicit TLS; 587/25 upgrade with STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" } : undefined,
    });
  }
  return transport;
}

function codeEmail(code: string) {
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:40px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1D1D1F;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:16px;padding:32px;">
      <tr>
        <td>
          <p style="margin:0 0 8px;font-size:17px;font-weight:600;">Sign in to Flyer Studio</p>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.4;color:#6E6E73;">Enter this code in the open tab. It expires in 10 minutes.</p>
          <p style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:0.2em;">${code}</p>
          <p style="margin:0;font-size:12px;color:#6E6E73;">If you didn't request this, you can ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = `Your Flyer Studio sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`;
  return { html, text };
}

/**
 * Emails a sign-in code over SMTP. Without SMTP in development the code is printed to
 * the API console instead, so sign-in works with no mail provider at all.
 */
export async function sendSignInCode(email: string, code: string) {
  if (!mailConfigured()) {
    if (isProduction) throw new Error("SMTP_NOT_CONFIGURED");
    console.log(`\n[mail] SMTP isn't configured — sign-in code for ${email}: ${code}\n`);
    return;
  }
  await getTransport().sendMail({
    from: process.env.MAIL_FROM || "Flyer Studio <no-reply@localhost>",
    to: email,
    subject: `${code} is your Flyer Studio code`,
    ...codeEmail(code),
  });
}
