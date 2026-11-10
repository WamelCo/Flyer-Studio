import { authConfigured, emailConfigured, formatPhone, studioNumber, whatsappGatewayConfigured } from "@flyer/auth";
import { whatsappStatus } from "@flyer/auth/gateway";
import { isDatabaseUnavailable, query, sql } from "@flyer/db";
import { log } from "@flyer/log";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { AuthUnavailableError, getSession } from "@/lib/auth/server";
import { safeNext } from "@/lib/auth/safe-next";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The visitor's session, or null — and whether the database can be reached at all. The
 * session may come from the 5-minute cookie cache without touching the database, and a
 * signed-out visit doesn't touch it either, so ask it directly: sending a code needs it, and
 * sending someone on to pages that can't load would bounce them straight back here.
 */
async function sessionState() {
  try {
    const session = await getSession();
    await query(sql`select 1`);
    return { session, unavailable: false };
  } catch (failure) {
    const unavailable = failure instanceof AuthUnavailableError || isDatabaseUnavailable(failure);
    if (!unavailable) log.error("auth.login_check_failed", { error: failure instanceof Error ? failure.message : String(failure) });
    return { session: null, unavailable };
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const error = typeof params.error === "string" ? params.error : undefined;
  const whatsappEnabled = authConfigured() && whatsappGatewayConfigured();
  // Without Resend, development prints codes in the server log; production can't send them.
  const emailEnabled = authConfigured() && (emailConfigured() || process.env.NODE_ENV !== "production");
  const configured = emailEnabled || whatsappEnabled;
  const studio = studioNumber();

  // Already signed in (a verified session, not just a cookie): straight on. A database that
  // can't be reached isn't "signed out": the form waits for it and carries on by itself.
  const { session, unavailable } = configured ? await sessionState() : { session: null, unavailable: false };
  if (session) redirect(next);
  // Codes can only go out while the studio's WhatsApp is connected; otherwise lead with email.
  const whatsappReady = whatsappEnabled && (await whatsappStatus(2_000))?.state === "ready";
  const leadWithWhatsApp = whatsappEnabled && (whatsappReady || !emailEnabled) && (params.method !== "email" || !emailEnabled);

  return (
    <section className="flex min-h-[calc(100dvh-var(--bar-height))] items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-panel bg-surface p-6 shadow-card sm:p-10">
        <LoginForm
          next={next}
          initialError={error}
          configured={configured}
          unavailable={unavailable}
          emailEnabled={emailEnabled}
          whatsappEnabled={whatsappEnabled}
          whatsappReady={whatsappReady}
          // WhatsApp first: most people already have an account there (their number).
          initialMethod={leadWithWhatsApp ? "whatsapp" : "email"}
          studioNumber={studio ? formatPhone(studio) : null}
          // Development without Resend: the code is printed where `pnpm dev` runs.
          emailCodeInTerminal={emailEnabled && !emailConfigured()}
          showDevHints={process.env.NODE_ENV !== "production"}
        />
      </div>
    </section>
  );
}
