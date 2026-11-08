"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { transitions } from "@/lib/motion";

const RESEND_COOLDOWN = 30;

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

const stepVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transitions.page },
  exit: { opacity: 0, y: -8, transition: transitions.fade },
};

const ERROR_COPY: Record<string, string> = {
  link_expired: "That sign-in link has expired. Request a new code below.",
  not_configured: "Sign-in isn't configured yet. Set BETTER_AUTH_SECRET in the root .env and make sure the API is running.",
  oauth: "Google sign-in didn't finish. Try again or use your email instead.",
};

interface LoginFormProps {
  next: string;
  initialError?: string;
  configured: boolean;
  googleEnabled: boolean;
  /** Digits in the emailed code — set by the API (AUTH_OTP_LENGTH). */
  otpLength: number;
}

export function LoginForm({ next, initialError, configured, googleEnabled, otpLength }: LoginFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError && configured ? (ERROR_COPY[initialError] ?? null) : null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    setPending(true);
    setError(null);
    const { error: otpError } = await authClient.emailOtp
      .sendVerificationOtp({ email, type: "sign-in" })
      .catch(() => ({ error: { status: 503 } }));
    setPending(false);
    if (otpError) {
      setError(
        otpError.status === 429
          ? "Too many attempts. Wait a minute, then try again."
          : otpError.status && otpError.status >= 500
            ? "We couldn't send the email right now. Check the SMTP settings in the root .env, then try again."
            : "We couldn't send a code to that address. Check it and try again.",
      );
      return false;
    }
    setCooldown(RESEND_COOLDOWN);
    return true;
  }

  async function onSubmitEmail(event: FormEvent) {
    event.preventDefault();
    if (!configured || pending) return;
    if (await sendCode()) {
      setStep("code");
      requestAnimationFrame(() => codeRef.current?.focus());
    }
  }

  async function verify(token: string) {
    setPending(true);
    setError(null);
    const { error: verifyError } = await authClient.signIn
      .emailOtp({ email, otp: token })
      .catch(() => ({ error: { status: 503 } }));
    if (verifyError) {
      setPending(false);
      setCode("");
      setError("That code didn't match or has expired. Try again or request a new one.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, otpLength);
    setCode(digits);
    if (digits.length === otpLength) void verify(digits);
  }

  async function signInWithGoogle() {
    setError(null);
    const { error: oauthError } = await authClient.signIn
      .social({ provider: "google", callbackURL: next, errorCallbackURL: "/login?error=oauth" })
      .catch(() => ({ error: { status: 503 } }));
    if (oauthError) setError("Google sign-in isn't available right now. Use your email instead.");
  }

  return (
    <div className="w-full max-w-sm">
      <AnimatePresence mode="wait" initial={false}>
        {step === "email" ? (
          <motion.form
            key="email"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onSubmit={onSubmitEmail}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-title text-fg">Sign in or create an account</h1>
              <p className="text-callout text-fg-secondary">We&rsquo;ll email you {otpLength === 8 ? "an" : "a"} {otpLength}-digit code. No password needed.</p>
            </div>
            <label className="sr-only" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!configured}
              aria-invalid={Boolean(error) || undefined}
            />
            <InlineMessage>{error}</InlineMessage>
            {/* A setup notice, not an input error: no red outline on the field. */}
            <InlineMessage tone="neutral">{configured ? null : ERROR_COPY.not_configured}</InlineMessage>
            <Button type="submit" size="lg" disabled={!configured || pending || !email}>
              {pending ? "Sending code…" : "Continue with email"}
            </Button>
            {googleEnabled && (
              <>
                <div className="flex items-center gap-3 text-caption text-fg-secondary">
                  <span className="h-px flex-1 bg-separator" />
                  or
                  <span className="h-px flex-1 bg-separator" />
                </div>
                <Button variant="secondary" size="lg" onClick={signInWithGoogle}>
                  <GoogleMark />
                  Continue with Google
                </Button>
              </>
            )}
          </motion.form>
        ) : (
          <motion.div
            key="code"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-title text-fg">Check your email</h1>
              <p className="text-callout text-fg-secondary">
                Enter the code we sent to <span className="font-medium text-fg">{email}</span>.
              </p>
            </div>
            <label className="sr-only" htmlFor="code">
              {otpLength}-digit code
            </label>
            <Input
              ref={codeRef}
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={`\\d{${otpLength}}`}
              maxLength={otpLength}
              placeholder={"0".repeat(otpLength)}
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
              disabled={pending}
              aria-invalid={Boolean(error) || undefined}
              className="text-center text-title tracking-widest"
            />
            <InlineMessage>{error}</InlineMessage>
            <InlineMessage tone="neutral">{pending ? "Signing you in…" : null}</InlineMessage>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
              >
                <ArrowLeft />
                Different email
              </Button>
              <Button variant="plain" size="sm" disabled={cooldown > 0 || pending} onClick={() => void sendCode()}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
