"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "@/lib/api/client";
import { OTP_LENGTH } from "@/lib/auth/client";
import { transitions } from "@/lib/motion";

/**
 * The account's email. An account made on WhatsApp can add one, to sign in with email too;
 * if that email already had its own web account, proving it folds that account in here.
 */
export function EmailLink({ email }: { email: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/account/email", { method: "POST", json: { email: address } });
      setStep("code");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't send a code to that address.");
    } finally {
      setPending(false);
    }
  }

  async function verify(otp: string) {
    setPending(true);
    setError(null);
    try {
      const result = await apiFetch<{ merged: boolean }>("/api/account/email", { method: "PUT", json: { code: otp } });
      if (result.merged) setNotice("Done — your web account's flyers and credits are now here too.");
      router.refresh();
    } catch (caught) {
      setCode("");
      setError(caught instanceof ApiError ? caught.message : "That code didn't match or has expired.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="email-heading" className="flex flex-col gap-5 rounded-panel bg-surface p-6 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-contrast">{email ? <Check aria-hidden /> : <Mail aria-hidden />}</span>
        <div className="flex flex-col">
          <h2 id="email-heading" className="text-headline text-fg">
            {email ? "Email" : "Add your email"}
          </h2>
          <span className="text-callout text-fg-secondary">{email ?? "Sign in with a code by email too. If you made a web account with it, that account joins this one."}</span>
        </div>
      </div>

      {!email && (
        <AnimatePresence mode="wait" initial={false}>
          {step === "email" ? (
            <motion.form key="email" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transitions.fade }} exit={{ opacity: 0 }} onSubmit={sendCode} className="flex flex-col gap-3">
              <label className="text-callout text-fg" htmlFor="account-email">
                Your email
              </label>
              <Input id="account-email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={address} onChange={(event) => setAddress(event.target.value)} />
              <Button type="submit" size="lg" disabled={pending || !address}>
                {pending ? "Sending code…" : "Send a code by email"}
              </Button>
            </motion.form>
          ) : (
            <motion.div key="code" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transitions.fade }} exit={{ opacity: 0 }} className="flex flex-col gap-3">
              <label className="text-callout text-fg" htmlFor="account-email-code">
                Enter the {OTP_LENGTH}-digit code we emailed to {address}
              </label>
              <Input
                id="account-email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                placeholder={"0".repeat(OTP_LENGTH)}
                value={code}
                disabled={pending}
                className="text-center text-title tracking-widest"
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH);
                  setCode(digits);
                  if (digits.length === OTP_LENGTH) void verify(digits);
                }}
              />
              <Button variant="ghost" size="sm" onClick={() => setStep("email")}>
                Different email
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      )}
      <InlineMessage>{error}</InlineMessage>
      <InlineMessage tone="neutral">{notice}</InlineMessage>
    </section>
  );
}
