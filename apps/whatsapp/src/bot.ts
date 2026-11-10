import { randomUUID } from "node:crypto";
import { createJob, runJob, type RunOutcome } from "@flyer/ai/jobs";
import type { GenerationInput } from "@flyer/ai/pipeline";
import { sanitizePrompt } from "@flyer/ai/prompt";
import { BillingError, getProfile, refreshPayment, startPayment } from "@flyer/billing/payments";
import { formatPrice } from "@flyer/billing/format";
import { CREDIT_COSTS, PLANS, type BillingInterval, type PaidPlanId } from "@flyer/billing/plans";
import { phoneAccount } from "@flyer/auth/accounts";
import { isPhoneEmail } from "@flyer/auth/phone";
import { MAX_PROMPT_LENGTH } from "@flyer/ai/prompt";
import { and, chargeForFlyer, creditLedger, db, eq, generationJobs, or, sql, whatsappChats, whatsappMessages } from "@flyer/db";
import { check, LIMITS } from "@flyer/db/rate-limit";
import type { FlyerDoc, FlyerFormat } from "@flyer/design/canvas/types";
import { renderPng } from "@flyer/design/render/png";
import { log } from "@flyer/log";

import type { Channel, Incoming } from "./channel";

/**
 * The WhatsApp conversation — self-contained. The first message from a number creates its
 * account on the spot (the number is the account: no sign-up, no other details) with 3 free
 * flyers. Describe a flyer, get one design back; reply with fixes and it is designed again with
 * them; start a message with "new" for a different flyer; "buy" sells a pass via Paynow.
 * Free flyers are watermarked and never use a paid Ideogram image; paid ones carry no mark.
 * Someone out of free flyers who has never bought gets two replies, then silence (until "buy").
 */

export interface BotDeps {
  channel: Channel;
  /** Runs a generation (tests swap in a fake). */
  generate?: (input: GenerationInput & { balance: number }) => Promise<RunOutcome>;
  /** Renders a design for the chat (tests swap in a fake). */
  render?: (doc: FlyerDoc, watermark: boolean) => Promise<Uint8Array>;
  /** How often and how long to check a pending payment (ms). */
  paymentPoll?: { everyMs: number; forMs: number };
}

const IMAGE_WIDTH = 1080;
/** Fixes apply to the last flyer for this long; after that a message is a new flyer. */
const FIX_WINDOW_MS = 2 * 60 * 60_000;
const OUT_OF_CREDIT_REPLIES = 2;
const PURCHASE_COMMANDS = ["buy", "upgrade", "pass", "passes", "pricing", "price", "prices", "pro", "max"];
const THANKS = ["thanks", "thank you", "thankyou", "thx", "ok", "okay", "cool", "great", "nice", "perfect", "awesome"];
const GREETINGS = ["hi", "hie", "hello", "hey", "help", "menu", "start", "info", "good morning", "good afternoon", "good evening"];
const COST = CREDIT_COSTS.generate;
const PASSES: Record<string, { plan: PaidPlanId; interval: BillingInterval }> = {
  "pro month": { plan: "pro", interval: "month" },
  "pro year": { plan: "pro", interval: "year" },
  "max month": { plan: "max", interval: "month" },
  "max year": { plan: "max", interval: "year" },
};

const defaultGenerate = async (input: GenerationInput & { balance: number }) => {
  await createJob(input);
  return runJob(input);
};
const defaultRender = async (doc: FlyerDoc, watermark: boolean) => new Uint8Array(await renderPng(doc, IMAGE_WIDTH, undefined, { watermark }));

/** The format a message asks for: Status/Stories are 9:16, "square" for Instagram, else a poster. */
export function formatFrom(text: string): FlyerFormat {
  if (/\b(status|story|stories|reel|tiktok|vertical)\b/i.test(text)) return "story";
  if (/\b(square|instagram post|ig post|insta post)\b/i.test(text)) return "square";
  if (/\b(landscape|banner|facebook cover|twitter header|horizontal)\b/i.test(text)) return "landscape";
  return "poster";
}

function plural(n: number, word: string) {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

export function createBot({ channel, generate = defaultGenerate, render = defaultRender, paymentPoll = { everyMs: 15_000, forMs: 30 * 60_000 } }: BotDeps) {
  const busy = new Set<string>();
  const say = (chatId: string, text: string) => channel.sendText(chatId, text);

  async function help(chatId: string, userId: string) {
    const profile = await getProfile(userId);
    await say(
      chatId,
      [
        "*Flyer Studio* 🎨",
        "Describe the flyer you need and I'll design it. For example:",
        "_Braai fundraiser at Hatfield Primary, Saturday 2pm, $5 a plate, call 0771 234 567_",
        "",
        "• After a flyer, reply with any fixes — or start with *new* for a different one",
        "• Add *status* for a WhatsApp Status size, or *square* for Instagram",
        "• *balance* — your credits",
        "• *buy* — get a Pro or Max pass",
        "",
        allowance(profile),
      ].join("\n"),
    );
  }

  /** What the person can still make, in one line. */
  function allowance(profile: { plan: keyof typeof PLANS; credits: number; freeFlyers: number }) {
    const free = profile.freeFlyers > 0 ? `${plural(profile.freeFlyers, "free flyer")} left` : null;
    const credits = profile.credits > 0 || profile.plan !== "free" ? `${plural(profile.credits, "credit")} (a flyer costs ${COST})` : null;
    if (free && credits) return `You have ${free} and ${credits}.`;
    if (free) return `You have ${free}.`;
    if (credits) return `You have ${credits}.`;
    return "You've used your free flyers — reply *buy* for a Pro or Max pass.";
  }

  async function balance(chatId: string, userId: string) {
    const profile = await getProfile(userId);
    const pass = profile.plan === "free" ? "Free plan" : `${PLANS[profile.plan].name} pass until ${profile.currentPeriodEnd?.toDateString().slice(4) ?? "—"}`;
    await say(chatId, `${pass}. ${allowance(profile)}`);
  }

  async function passes(chatId: string) {
    const lines = Object.entries(PASSES).map(([command, { plan, interval }]) => {
      const p = PLANS[plan];
      const credits = p.monthlyCredits * (interval === "year" ? 12 : 1);
      return `• *${command}* — ${p.name}, ${interval === "year" ? "12 months" : "1 month"}: ${formatPrice(p.price[interval])} (${credits.toLocaleString("en-US")} credits)`;
    });
    await say(chatId, ["Passes are paid once with Paynow (EcoCash, OneMoney, cards). Nothing renews automatically.", "", ...lines, "", "Reply with the one you want, e.g. *pro month*."].join("\n"));
  }

  async function buy(chatId: string, account: { id: string; email: string }, choice: { plan: PaidPlanId; interval: BillingInterval }) {
    try {
      const { paymentId, redirectUrl } = await startPayment({ id: account.id, email: isPhoneEmail(account.email) ? null : account.email }, choice.plan, choice.interval);
      await say(chatId, `Pay ${formatPrice(PLANS[choice.plan].price[choice.interval])} for ${PLANS[choice.plan].name} here:\n${redirectUrl}\n\nI'll message you as soon as Paynow confirms it.`);
      watchPayment(chatId, paymentId, account.id);
    } catch (error) {
      if (error instanceof BillingError) return say(chatId, error.code === "PAYMENTS_NOT_CONFIGURED" ? "Payments aren't set up yet — please try again later." : "Paynow couldn't start the payment. Please try again in a moment.");
      throw error;
    }
  }

  /** Paynow also confirms through the web app; this just tells the person in the chat. */
  function watchPayment(chatId: string, paymentId: string, userId: string) {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const payment = await refreshPayment(paymentId, userId);
        if (payment?.status === "paid") {
          clearInterval(timer);
          const profile = await getProfile(userId);
          await say(chatId, `Payment received ✅ Your ${PLANS[payment.plan].name} pass is active until ${profile.currentPeriodEnd?.toDateString().slice(4)}. You have ${plural(profile.credits, "credit")}.`);
        } else if (payment?.status === "cancelled" || payment?.status === "failed" || Date.now() - started > paymentPoll.forMs) {
          clearInterval(timer);
          if (payment?.status === "cancelled" || payment?.status === "failed") await say(chatId, "That payment didn't go through. Reply *buy* to try again.");
        }
      } catch (error) {
        log.warn("whatsapp.payment_watch_failed", { paymentId, reason: error instanceof Error ? error.message : String(error) });
      }
    }, paymentPoll.everyMs);
    timer.unref?.();
  }

  /** The chat's last flyer, if it is recent enough to fix. */
  async function lastFlyer(phone: string, userId: string) {
    const [chat] = await db().select({ jobId: whatsappChats.lastJobId }).from(whatsappChats).where(eq(whatsappChats.phone, phone)).limit(1);
    if (!chat?.jobId) return null;
    const [job] = await db()
      .select({ prompt: generationJobs.prompt, format: generationJobs.format, result: generationJobs.result, freeFlyer: generationJobs.freeFlyer, completedAt: generationJobs.completedAt })
      .from(generationJobs)
      .where(and(eq(generationJobs.id, chat.jobId), eq(generationJobs.userId, userId)))
      .limit(1);
    if (!job) return null;
    const doc = (job.result as { docs?: FlyerDoc[] } | null)?.docs?.[0];
    return { ...job, doc, recent: Boolean(job.completedAt && Date.now() - job.completedAt.getTime() < FIX_WINDOW_MS) };
  }

  /** "resend": the last flyer again (after WhatsApp failed to upload it). Free. */
  async function resend(chatId: string, phone: string, userId: string) {
    const last = await lastFlyer(phone, userId);
    if (!last?.doc) return say(chatId, "There's no flyer to resend yet — describe the one you need.");
    try {
      await channel.sendImage(chatId, await render(last.doc, last.freeFlyer), "Here's your flyer again ✨", "flyer.png");
    } catch {
      await say(chatId, "WhatsApp still couldn't send it — please try *resend* again in a few minutes.");
    }
  }

  /** The original request plus the fix, within the prompt limit (the fix always fits). */
  function withFix(original: string, fix: string) {
    const tail = `\nChanges: ${fix}`;
    return `${original.slice(0, Math.max(0, MAX_PROMPT_LENGTH - tail.length))}${tail}`;
  }

  /** Has this account ever paid (a pass, or credits granted)? Payers always get answers. */
  async function hasPaid(userId: string) {
    const [row] = await db()
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, userId), or(sql`${creditLedger.reason} like 'pass:%'`, sql`${creditLedger.reason} like 'grant:%'`)))
      .limit(1);
    return Boolean(row);
  }

  /** Counts a reply to someone out of free flyers; returns how many they have now had. */
  async function countOutOfCreditReply(phone: string, userId: string) {
    const [row] = await db()
      .insert(whatsappChats)
      .values({ phone, userId, outOfCreditReplies: 1 })
      .onConflictDoUpdate({ target: whatsappChats.phone, set: { outOfCreditReplies: sql`${whatsappChats.outOfCreditReplies} + 1`, updatedAt: sql`now()` } })
      .returning({ count: whatsappChats.outOfCreditReplies });
    return row?.count ?? 1;
  }

  async function flyer(chatId: string, phone: string, userId: string, text: string, greeting?: string, format?: FlyerFormat) {
    // Claimed before anything is awaited, so two quick messages can't both start (and pay for) a flyer.
    if (busy.has(phone)) return say(chatId, "Still working on your last flyer — it'll be here in a moment.");
    busy.add(phone);
    try {
      await designFlyer(chatId, phone, userId, sanitizePrompt(text), greeting, format);
    } finally {
      busy.delete(phone);
    }
  }

  async function designFlyer(chatId: string, phone: string, userId: string, prompt: string, greeting?: string, format: FlyerFormat = formatFrom(prompt)) {
    const { blocked } = await check(LIMITS.generate(userId));
    if (blocked) return say(chatId, "You're making flyers very quickly. Give it a minute and try again.");

    const jobId = randomUUID();
    const profile = await getProfile(userId);
    // Free plan: free flyers first. Pro/Max: credits first.
    const charge = await chargeForFlyer({ userId, jobId, cost: COST, preferFree: profile.plan === "free" });
    if (!charge.ok) {
      return say(chatId, `You've used your free flyers, and a flyer needs ${COST} credits (you have ${charge.balance}). Reply *buy* for a Pro or Max pass.`);
    }
    const free = charge.free;

    const working = free ? `Designing your flyer — this one's free (${plural(charge.freeLeft, "free flyer")} left after it). About a minute…` : "Designing your flyer — about a minute…";
    await say(chatId, greeting ? `${greeting}\n\n${working}` : working);
    void channel.typing?.(chatId).catch(() => undefined);
    // One design per request: the Ideogram lead when it runs (paid), else the engine's best.
    const outcome = await generate({ jobId, userId, prompt, format, cost: free ? 0 : COST, balance: charge.balance, channel: "whatsapp", ideogram: !free, freeFlyer: free, variations: 1 });
    if (!outcome.ok) {
      // The job runner has already given back the credits or the free flyer.
      return say(
        chatId,
        outcome.code === "GENERATION_BLOCKED"
          ? "I can't design that one. Please try a different description."
          : free
            ? "Something went wrong designing that — your free flyer is still yours. Please send it again."
            : outcome.message,
      );
    }
    await db()
      .insert(whatsappChats)
      .values({ phone, userId, lastJobId: jobId })
      .onConflictDoUpdate({ target: whatsappChats.phone, set: { userId, lastJobId: jobId, updatedAt: sql`now()` } });

    const after = await getProfile(userId);
    const caption = [
      "Here's your flyer ✨",
      "Need any fixes? Reply with what to change — e.g. _make the date bigger_ or _use blue_. Start with *new* for a different flyer.",
      allowance(after),
    ].join("\n\n");
    try {
      // Only free flyers carry the watermark; anything paid for is clean.
      await channel.sendImage(chatId, await render(outcome.response.docs[0]!, free), caption, "flyer.png");
    } catch (error) {
      log.warn("whatsapp.image_failed", { reason: (error instanceof Error ? error.message : String(error)).split("\n")[0] });
      await say(chatId, "Your flyer is ready, but WhatsApp couldn't upload it just now. Reply *resend* to try again.");
    }
  }

  async function handle(message: Incoming) {
    // A redelivered message is handled once.
    const claimed = await db().insert(whatsappMessages).values({ id: message.id, phone: message.phone ?? message.chatId }).onConflictDoNothing().returning({ id: whatsappMessages.id });
    if (!claimed.length) return;

    if (!message.phone) {
      return say(message.chatId, "I couldn't read your number. Please message from a phone with WhatsApp, not a linked device.");
    }
    const { blocked } = await check(LIMITS.whatsapp(message.phone));
    if (blocked) return;

    // The number is the account: the first message creates it (with its 3 free flyers).
    const account = await phoneAccount(message.phone);
    const text = message.kind === "text" ? message.body.trim() : "";
    const command = text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

    if (account.created) {
      log.info("whatsapp.account_created", { userId: account.id });
      const welcome = "Welcome to Flyer Studio 👋 Your account is ready — it's this WhatsApp number, nothing to sign up for. Your first 3 flyers are free.";
      // A first message that already describes a flyer gets started straight away.
      if (message.kind === "text" && !GREETINGS.includes(command) && sanitizePrompt(text).length >= 12) {
        return flyer(message.chatId, message.phone, account.id, text, welcome);
      }
      return say(
        message.chatId,
        [
          welcome,
          "",
          "Describe the flyer you need and I'll design it. For example:",
          "_Braai fundraiser at Hatfield Primary, Saturday 2pm, $5 a plate, call 0771 234 567_",
          "",
          "Add *status* for a WhatsApp Status size, or *square* for Instagram. Reply *help* any time.",
        ].join("\n"),
      );
    }

    // Out of free flyers and never bought: two replies, then quiet — except to buy.
    const isPurchase = PURCHASE_COMMANDS.includes(command) || Boolean(PASSES[command]);
    if (!isPurchase) {
      const profile = await getProfile(account.id);
      if (profile.plan === "free" && profile.freeFlyers === 0 && profile.credits < COST && !(await hasPaid(account.id))) {
        const count = await countOutOfCreditReply(message.phone, account.id);
        if (count > OUT_OF_CREDIT_REPLIES) return;
        return say(
          message.chatId,
          count < OUT_OF_CREDIT_REPLIES
            ? "You've used your 3 free flyers. To keep making flyers, get a Pro or Max pass — reply *buy* to see them."
            : "Reply *buy* for a Pro or Max pass to keep making flyers. I'll stay quiet until then.",
        );
      }
    }

    if (message.kind !== "text") return say(message.chatId, "I can only read text for now — describe your flyer in a message.");

    if (GREETINGS.includes(command)) return help(message.chatId, account.id);
    if (THANKS.includes(command)) return say(message.chatId, "You're welcome! Send *new* and a description whenever you need another flyer.");
    if (["balance", "credits", "credit"].includes(command)) return balance(message.chatId, account.id);
    if (PURCHASE_COMMANDS.includes(command)) return passes(message.chatId);
    if (PASSES[command]) return buy(message.chatId, account, PASSES[command]!);
    if (["resend", "send again", "again"].includes(command)) return resend(message.chatId, message.phone, account.id);

    // "new …" is always a different flyer; anything else right after a flyer is a fix to it.
    const fresh = /^new\b[\s:,-]*/i.test(text);
    const request = fresh ? text.replace(/^new\b(\s+flyer\b)?[\s:,-]*/i, "").trim() : text;
    if (!fresh) {
      const last = await lastFlyer(message.phone, account.id);
      if (last?.recent && request.length >= 3) {
        return flyer(message.chatId, message.phone, account.id, withFix(last.prompt, request), undefined, last.format as FlyerFormat);
      }
    }
    if (sanitizePrompt(request).length < 12) return help(message.chatId, account.id);
    return flyer(message.chatId, message.phone, account.id, request);
  }

  return {
    async handle(message: Incoming) {
      try {
        await handle(message);
      } catch (error) {
        log.error("whatsapp.message_failed", { reason: error instanceof Error ? error.message : String(error) });
        await say(message.chatId, "Sorry — something went wrong on our side. Please try again in a minute.").catch(() => undefined);
      }
    },
  };
}
