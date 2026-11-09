import { randomUUID } from "node:crypto";
import { createJob, runJob, type RunOutcome } from "@flyer/ai/jobs";
import type { GenerationInput } from "@flyer/ai/pipeline";
import { sanitizePrompt } from "@flyer/ai/prompt";
import { BillingError, getProfile, refreshPayment, siteUrl, startPayment } from "@flyer/billing/payments";
import { formatPrice } from "@flyer/billing/format";
import { CREDIT_COSTS, PLANS, type BillingInterval, type PaidPlanId } from "@flyer/billing/plans";
import { phoneAccount } from "@flyer/auth/accounts";
import { isPhoneEmail } from "@flyer/auth/phone";
import { and, chargeForFlyer, db, eq, flyerProjects, generationJobs, sql, whatsappChats, whatsappMessages } from "@flyer/db";
import { check, LIMITS } from "@flyer/db/rate-limit";
import type { FlyerDoc, FlyerFormat } from "@flyer/design/canvas/types";
import { renderPng } from "@flyer/design/render/png";
import { log } from "@flyer/log";

import type { Channel, Incoming } from "./channel";

/**
 * The WhatsApp conversation — self-contained. The first message from a number creates its
 * account on the spot (the number is the account: no sign-up, no other details) with 3 free
 * flyers. Describe a flyer, get three designs back as images; "1", "2" or "3" opens one in the
 * web editor (sign in there with the same number: same account); "buy" sells a pass via Paynow.
 * Free flyers are watermarked and never use a paid Ideogram image.
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
        "Describe the flyer you need and I'll design three options. For example:",
        "_Braai fundraiser at Hatfield Primary, Saturday 2pm, $5 a plate, call 0771 234 567_",
        "",
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

  /** "1", "2" or "3": an editor link for that design of the last flyer. */
  async function openDesign(chatId: string, phone: string, userId: string, index: number) {
    const [chat] = await db().select({ jobId: whatsappChats.lastJobId }).from(whatsappChats).where(eq(whatsappChats.phone, phone)).limit(1);
    const [job] = chat?.jobId
      ? await db()
          .select({ result: generationJobs.result, projectId: generationJobs.projectId, format: generationJobs.format })
          .from(generationJobs)
          .where(and(eq(generationJobs.id, chat.jobId), eq(generationJobs.userId, userId)))
          .limit(1)
      : [];
    const docs = (job?.result as { docs?: FlyerDoc[] } | null)?.docs;
    if (!job || !docs?.[index]) return say(chatId, "Describe a flyer first — then reply 1, 2 or 3 to open a design.");
    let projectId = job.projectId;
    if (index > 0 || !projectId) {
      const [project] = await db()
        .insert(flyerProjects)
        .values({ userId, title: `Flyer — design ${index + 1}`, format: job.format, canvas: JSON.parse(JSON.stringify(docs[index])), generationId: chat!.jobId })
        .returning({ id: flyerProjects.id });
      projectId = project!.id;
    }
    await say(chatId, `Design ${index + 1} is ready to edit, with HD, PDF and Photoshop export:\n${siteUrl()}/editor/${projectId}\n(Sign in there with this WhatsApp number — it's the same account.)`);
  }

  async function flyer(chatId: string, phone: string, userId: string, text: string, greeting?: string) {
    // Claimed before anything is awaited, so two quick messages can't both start (and pay for) a flyer.
    if (busy.has(phone)) return say(chatId, "Still working on your last flyer — it'll be here in a moment.");
    busy.add(phone);
    try {
      await designFlyer(chatId, phone, userId, sanitizePrompt(text), greeting);
    } finally {
      busy.delete(phone);
    }
  }

  async function designFlyer(chatId: string, phone: string, userId: string, prompt: string, greeting?: string) {
    const { blocked } = await check(LIMITS.generate(userId));
    if (blocked) return say(chatId, "You're making flyers very quickly. Give it a minute and try again.");

    const jobId = randomUUID();
    const profile = await getProfile(userId);
    // Free plan: free flyers first (watermarked either way). Pro/Max: credits first.
    const charge = await chargeForFlyer({ userId, jobId, cost: COST, preferFree: profile.plan === "free" });
    if (!charge.ok) {
      return say(chatId, `You've used your free flyers, and a flyer needs ${COST} credits (you have ${charge.balance}). Reply *buy* for a Pro or Max pass.`);
    }
    const free = charge.free;

    const working = free
      ? `Designing three options — this one's free (${plural(charge.freeLeft, "free flyer")} left after it). About a minute…`
      : "Designing three options for you — about a minute…";
    await say(chatId, greeting ? `${greeting}\n\n${working}` : working);
    void channel.typing?.(chatId).catch(() => undefined);
    const outcome = await generate({ jobId, userId, prompt, format: formatFrom(prompt), cost: free ? 0 : COST, balance: charge.balance, channel: "whatsapp", ideogram: !free, freeFlyer: free });
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
    const watermark = free || PLANS[profile.plan].watermark;
    const { docs, directions } = outcome.response;
    let delivered = 0;
    for (const [i, doc] of docs.entries()) {
      const label = directions[i];
      try {
        await channel.sendImage(chatId, await render(doc, watermark), `${i + 1} · ${label?.layout ?? "Design"}${label?.palette ? ` · ${label.palette}` : ""}`, `flyer-${i + 1}.png`);
        delivered += 1;
      } catch (error) {
        log.warn("whatsapp.image_failed", { design: i + 1, reason: (error instanceof Error ? error.message : String(error)).split("\n")[0] });
      }
    }
    // The designs exist either way (saved as a project): never leave someone with nothing.
    if (delivered < docs.length) {
      await say(
        chatId,
        delivered === 0
          ? `Your designs are ready, but WhatsApp couldn't upload the pictures just now. Open them here:\n${siteUrl()}/editor/${outcome.response.projectId}\n(Sign in with this WhatsApp number.) Reply *1*, *2* or *3* for the others.`
          : `${docs.length - delivered} of the pictures didn't upload — reply its number to open it in the editor instead.`,
      );
    }
    await db()
      .insert(whatsappChats)
      .values({ phone, userId, lastJobId: jobId })
      .onConflictDoUpdate({ target: whatsappChats.phone, set: { userId, lastJobId: jobId, updatedAt: sql`now()` } });
    const after = await getProfile(userId);
    await say(chatId, [`Reply *1*, *2* or *3* to open a design in the editor (HD, PDF, Photoshop).`, allowance(after)].join("\n"));
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
          "Describe the flyer you need and I'll design three options. For example:",
          "_Braai fundraiser at Hatfield Primary, Saturday 2pm, $5 a plate, call 0771 234 567_",
          "",
          "Add *status* for a WhatsApp Status size, or *square* for Instagram. Reply *help* any time.",
        ].join("\n"),
      );
    }

    if (message.kind !== "text") return say(message.chatId, "I can only read text for now — describe your flyer in a message.");

    if (GREETINGS.includes(command)) return help(message.chatId, account.id);
    if (["balance", "credits", "credit"].includes(command)) return balance(message.chatId, account.id);
    if (["buy", "upgrade", "pass", "passes", "pricing", "price", "prices", "pro", "max"].includes(command)) return passes(message.chatId);
    if (PASSES[command]) return buy(message.chatId, account, PASSES[command]!);
    if (/^[1-3]$/.test(command)) return openDesign(message.chatId, message.phone, account.id, Number(command) - 1);
    if (sanitizePrompt(text).length < 12) return help(message.chatId, account.id);
    return flyer(message.chatId, message.phone, account.id, text);
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
