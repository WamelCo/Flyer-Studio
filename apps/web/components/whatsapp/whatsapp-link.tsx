"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { toE164 } from "@/components/auth/login-form";
import { Button, ButtonLink } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "@/lib/api/client";
import { OTP_LENGTH } from "@/lib/auth/client";
import { transitions } from "@/lib/motion";

interface WhatsAppLinkProps {
  linked: string | null;
  canUnlink: boolean;
  available: boolean;
  /** The studio's WhatsApp number when the service is connected. */
  studioNumber: string | null;
  /** The number formatted for people, e.g. +263 71 772 6626. */
  studioLabel: string;
  /** Whether the studio phone is connected right now (codes and flyers can be sent). */
  connected: boolean;
}

const HOW_IT_WORKS = [
  "Send a description: “Braai fundraiser at Hatfield Primary, Saturday 2pm, $5 a plate”.",
  "Three designs arrive in the chat in about a minute — 5 credits, like on the web.",
  "Reply 1, 2 or 3 to open one in the editor for HD, PDF or Photoshop export.",
];

export function WhatsAppLink({ linked, canUnlink, available, studioNumber, studioLabel, connected }: WhatsAppLinkProps) {
  const router = useRouter();
  const [step, setStep] = useState<"number" | "code">("number");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const number = toE164(phone);
  const chat = studioNumber ? `https://wa.me/${studioNumber.replace(/\D/g, "")}?text=${encodeURIComponent("Hi")}` : null;

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (!number) return setError("Enter your WhatsApp number with its country code, e.g. +263 77 123 4567.");
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/whatsapp/link", { method: "POST", json: { phone: number } });
      setStep("code");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't send a code to that number.");
    } finally {
      setPending(false);
    }
  }

  async function verify(otp: string) {
    setPending(true);
    setError(null);
    try {
      // If this number already made flyers on WhatsApp, that account joins this one.
      await apiFetch("/api/whatsapp/link", { method: "PUT", json: { code: otp } });
      router.refresh();
    } catch (caught) {
      setCode("");
      setError(caught instanceof ApiError ? caught.message : "That code didn't match or has expired.");
    } finally {
      setPending(false);
    }
  }

  async function unlink() {
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/whatsapp/link", { method: "DELETE" });
      router.refresh();
    } catch {
      setError("We couldn't unlink that number. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="link-heading" className="flex flex-col gap-5 rounded-panel bg-surface p-6 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-contrast">
            {linked ? <Check aria-hidden /> : <MessageCircle aria-hidden />}
          </span>
          <div className="flex flex-col">
            <h2 id="link-heading" className="text-headline text-fg">
              {linked ? "WhatsApp is linked" : "Link your WhatsApp"}
            </h2>
            <span className="text-callout text-fg-secondary">{linked ?? "Messages from your number will use this account."}</span>
          </div>
        </div>

        {!available ? (
          <InlineMessage tone="neutral">WhatsApp isn&rsquo;t switched on for this studio yet.</InlineMessage>
        ) : linked ? (
          <div className="flex flex-wrap gap-3">
            {chat && (
              <ButtonLink href={chat} size="lg">
                Open the chat
              </ButtonLink>
            )}
            {canUnlink && (
              <Button variant="secondary" size="lg" disabled={pending} onClick={() => void unlink()}>
                Unlink number
              </Button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {step === "number" ? (
              <motion.form key="number" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transitions.fade }} exit={{ opacity: 0 }} onSubmit={sendCode} className="flex flex-col gap-3">
                <label className="text-callout text-fg" htmlFor="wa-phone">
                  Your WhatsApp number
                </label>
                <Input id="wa-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+263 77 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} />
                <Button type="submit" size="lg" disabled={pending || !phone}>
                  {pending ? "Sending code…" : "Send a code on WhatsApp"}
                </Button>
              </motion.form>
            ) : (
              <motion.div key="code" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transitions.fade }} exit={{ opacity: 0 }} className="flex flex-col gap-3">
                <label className="text-callout text-fg" htmlFor="wa-code">
                  Enter the {OTP_LENGTH}-digit code we sent to {number}
                </label>
                <Input
                  id="wa-code"
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
                <Button variant="ghost" size="sm" onClick={() => setStep("number")}>
                  Different number
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        <InlineMessage>{error}</InlineMessage>
      </section>

      <section aria-labelledby="how-heading" className="flex flex-col gap-4 rounded-panel bg-surface p-6 shadow-card">
        <h2 id="how-heading" className="text-headline text-fg">
          How it works
        </h2>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-callout text-fg">
          {HOW_IT_WORKS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        {studioNumber && (
          <p className="text-callout text-fg">
            Flyer Studio on WhatsApp: <span className="font-semibold">{studioLabel}</span>
            {!connected && available && <span className="text-fg-secondary"> — offline right now, back soon</span>}
          </p>
        )}
        <p className="text-caption text-fg-secondary">Your first WhatsApp flyer is free (watermarked). After that, flyers use your credits; reply “buy” in the chat for a Pro or Max pass.</p>
      </section>
    </div>
  );
}
