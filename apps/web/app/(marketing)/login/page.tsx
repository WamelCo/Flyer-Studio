import { authConfigured, emailConfigured, formatPhone, studioNumber, whatsappGatewayConfigured } from "@flyer/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getSession } from "@/lib/auth/server";
import { safeNext } from "@/lib/auth/safe-next";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const error = typeof params.error === "string" ? params.error : undefined;
  const whatsappEnabled = authConfigured() && whatsappGatewayConfigured();
  // Without Resend, development prints codes in the server log; production can't send them.
  const emailEnabled = authConfigured() && (emailConfigured() || process.env.NODE_ENV !== "production");
  const configured = emailEnabled || whatsappEnabled;
  const studio = studioNumber();
  // Already signed in (a verified session, not just a cookie): straight on.
  if (configured && (await getSession().catch(() => null))) redirect(next);

  return (
    <section className="flex min-h-[calc(100dvh-var(--bar-height))] items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-panel bg-surface p-6 shadow-card sm:p-10">
        <LoginForm
          next={next}
          initialError={error}
          configured={configured}
          emailEnabled={emailEnabled}
          whatsappEnabled={whatsappEnabled}
          // WhatsApp first: most people already have an account there (their number).
          initialMethod={whatsappEnabled && (params.method !== "email" || !emailEnabled) ? "whatsapp" : "email"}
          studioNumber={studio ? formatPhone(studio) : null}
          // Development without Resend: the code is printed where `pnpm dev` runs.
          emailCodeInTerminal={emailEnabled && !emailConfigured()}
        />
      </div>
    </section>
  );
}
