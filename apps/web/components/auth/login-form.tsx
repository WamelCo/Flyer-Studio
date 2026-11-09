"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { authClient, authErrorMessage, OTP_LENGTH } from "@/lib/auth/client";
import { transitions } from "@/lib/motion";

const RESEND_COOLDOWN = 30;

type Method = "email" | "whatsapp";

const stepVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transitions.page },
  exit: { opacity: 0, y: -8, transition: transitions.fade },
};

const ERROR_COPY: Record<string, string> = {
  link_expired: "That sign-in link has expired. Request a new code below.",
  not_configured: "Sign-in isn't configured yet. Set DATABASE_URL and BETTER_AUTH_SECRET, then restart the server.",
};

/** E.164 from what people type; a leading 0 is read as a Zimbabwe number (+263). */
export function toE164(input: string) {
  const raw = input.trim();
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0")) digits = `263${digits.slice(1)}`;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

interface LoginFormProps {
  next: string;
  initialError?: string;
  configured: boolean;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  initialMethod?: Method;
  /** The studio's WhatsApp number, formatted — WhatsApp codes come from it. */
  studioNumber?: string | null;
  /** Development without an email service: the code is printed in the terminal running the app. */
  emailCodeInTerminal?: boolean;
}

export function LoginForm({ next, initialError, configured, emailEnabled, whatsappEnabled, initialMethod = "whatsapp", studioNumber, emailCodeInTerminal }: LoginFormProps) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>(whatsappEnabled && (initialMethod === "whatsapp" || !emailEnabled) ? "whatsapp" : "email");
  const [step, setStep] = useState<"contact" | "code">("contact");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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

  const number = toE164(phone);
  const recipient = method === "email" ? email : (number ?? phone);

  async function sendCode() {
    setPending(true);
    setError(null);
    const { error: sendError } =
      method === "email"
        ? await authClient().emailOtp.sendVerificationOtp({ email, type: "sign-in" })
        : await authClient().phoneNumber.sendOtp({ phoneNumber: number! });
    setPending(false);
    if (sendError) {
      setError(
        authErrorMessage(
          sendError,
          method === "email" ? "We couldn't send a code to that address. Check it and try again." : "We couldn't send a WhatsApp code to that number. Check it and try again.",
        ),
      );
      return false;
    }
    setCooldown(RESEND_COOLDOWN);
    return true;
  }

  async function onSubmitContact(event: FormEvent) {
    event.preventDefault();
    if (!configured || pending) return;
    if (method === "whatsapp" && !number) {
      setError("Enter your WhatsApp number with its country code, e.g. +263 77 123 4567.");
      return;
    }
    if (await sendCode()) {
      setStep("code");
      requestAnimationFrame(() => codeRef.current?.focus());
    }
  }

  async function verify(otp: string) {
    setPending(true);
    setError(null);
    const { error: verifyError } =
      method === "email"
        ? await authClient().signIn.emailOtp({ email, otp })
        : await authClient().phoneNumber.verify({ phoneNumber: number!, code: otp });
    if (verifyError) {
      setPending(false);
      setCode("");
      setError(authErrorMessage(verifyError, "That code didn't match or has expired. Try again or request a new one."));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setCode(digits);
    if (digits.length === OTP_LENGTH) void verify(digits);
  }

  return (
    <div className="w-full max-w-sm">
      <AnimatePresence mode="wait" initial={false}>
        {step === "contact" ? (
          <motion.form
            key="contact"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onSubmit={onSubmitContact}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-title text-fg">Sign in or create an account</h1>
              <p className="text-callout text-fg-secondary">
                We&rsquo;ll send you a {OTP_LENGTH}-digit code {method === "email" ? "by email" : "on WhatsApp"}. No password needed.
              </p>
              {method === "whatsapp" && studioNumber && (
                <p className="text-caption text-fg-secondary">
                  It comes from Flyer Studio on WhatsApp, <span className="font-medium text-fg">{studioNumber}</span>.
                </p>
              )}
            </div>
            {whatsappEnabled && emailEnabled && (
              <div className="flex justify-center">
                <SegmentedControl
                  label="Sign-in method"
                  value={method}
                  onChange={(value) => {
                    setMethod(value);
                    setError(null);
                  }}
                  options={[
                    { value: "whatsapp", label: "WhatsApp" },
                    { value: "email", label: "Email" },
                  ]}
                />
              </div>
            )}
            {method === "email" ? (
              <>
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
              </>
            ) : (
              <>
                <label className="sr-only" htmlFor="phone">
                  WhatsApp number
                </label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  required
                  autoFocus
                  placeholder="+263 77 123 4567"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  aria-invalid={Boolean(error) || undefined}
                />
              </>
            )}
            <InlineMessage>{error}</InlineMessage>
            {/* A setup notice, not an input error: no red outline on the field. */}
            <InlineMessage tone="neutral">{configured ? null : ERROR_COPY.not_configured}</InlineMessage>
            <Button type="submit" size="lg" disabled={!configured || pending || !(method === "email" ? email : phone)}>
              {pending ? "Sending code…" : method === "email" ? "Continue with email" : "Send code on WhatsApp"}
            </Button>
          </motion.form>
        ) : (
          <motion.div key="code" variants={stepVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-title text-fg">{method === "email" ? "Check your email" : "Check WhatsApp"}</h1>
              <p className="text-callout text-fg-secondary">
                Enter the code we sent to <span className="font-medium text-fg">{recipient}</span>
                {method === "whatsapp" && studioNumber ? (
                  <>
                    {" "}
                    from <span className="font-medium text-fg">{studioNumber}</span>
                  </>
                ) : null}
                .
              </p>
              {method === "email" && emailCodeInTerminal && (
                <p className="text-caption text-fg-secondary">Development: no email service is set up, so the code is printed in the terminal running the app.</p>
              )}
            </div>
            <label className="sr-only" htmlFor="code">
              {OTP_LENGTH}-digit code
            </label>
            <Input
              ref={codeRef}
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern={`\\d{${OTP_LENGTH}}`}
              maxLength={OTP_LENGTH}
              placeholder={"0".repeat(OTP_LENGTH)}
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
                  setStep("contact");
                  setCode("");
                  setError(null);
                }}
              >
                <ArrowLeft />
                {method === "email" ? "Different email" : "Different number"}
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
