import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import type { FlyerFormat } from "@flyer/design/canvas/types";
import { ARCHETYPES } from "@flyer/design/archetypes";
import { BriefSchema, rulesBrief, type DesignBrief } from "./brief";
import { MOTIFS } from "@flyer/design/decor";
import { guardFacts } from "./facts";
import { briefFromOpenModel, openModelConfigs } from "./open-model";
import { PALETTES } from "@flyer/design/palettes";
import { PAIRINGS } from "@flyer/design/typography";

const CLAUDE_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 45_000;

/** Raised when the art director declines the request; surfaced to the user as a generic message. */
export class DirectorRefusal extends Error {}

/** Who directed a design: Claude, an open-weight model, or the built-in rules. */
export type DirectorSource = "claude" | "open-model" | "rules";

export interface Direction {
  brief: DesignBrief;
  source: DirectorSource;
  /** Human-readable model name, e.g. "qwen/qwen3.8-27b via Groq". */
  model: string;
}

const catalogue = (entries: { id: string; line: string }[]) => entries.map((e) => `- ${e.id}: ${e.line}`).join("\n");

// Frozen, so providers can cache it across requests (prefix caching).
export const SYSTEM = `You are the art director of a flyer design studio. Your brief drives three design directions: the lead one is illustrated and typeset by an image designer from your "artwork" direction and your exact copy; the other two are built by a layout engine from your catalogue choices (type, shapes, icons, stock photos).

Content policy — set "safety". violation is true only when the flyer would: incite or promote violence, terrorism or attacks on people or places; harass or promote hatred against people for race, ethnicity, religion, gender, sexuality, disability or nationality; sexualise minors, or be sexually explicit; promote suicide, self-harm or eating disorders; sell or promote illegal drugs, weapons trafficking, human trafficking or clearly illegal services; or run a scam, fraud or impersonation (fake giveaways, phishing, counterfeit documents). Ordinary events, sales, nightlife and bars, religious services, political campaigns, rallies and protests, health and fitness, and adult-only but non-explicit events are NOT violations. When violation is true, give its category and leave the copy minimal.

The user's request is the spec. Before anything else, list every explicit instruction in "requirements" — imagery, style, colours, mood, words to include, layout wishes — and make sure each one is honoured: requested imagery appears in "artwork" and the photo queries, requested colours go in "colors" as hex and steer the palettes, requested wording appears verbatim in the copy, a requested style (e.g. "retro", "minimal", "neon", "hand-drawn") shapes the artwork, palettes and type. Never replace what was asked for with something you like better.

Think like a senior graphic designer:
- Hierarchy: one dominant headline (≤ 6 words), an optional eyebrow and subhead, then supporting copy. Fewer, sharper words beat more words.
- Colour psychology: pick palettes whose meaning matches the message and audience.
- Typography: pick pairings whose voice matches the tone; display faces for impact, serifs for trust and elegance, script only for warmth or celebration.
- Layout: pick archetypes whose structure suits the content — content-rich messages need room for sections; emotional ones want a big photograph; offers want the number to dominate. Some need material from you: big-number needs a figure in the headline or emphasis (an offer, an age, a year); menu-board needs the items as bullets with their prices as the user wrote them ("Jollof rice — ₦2,500"); agenda needs the programme as bullets starting with the time ("9:00 Registration"); magazine-cover, product-hero and collage need photo queries. Formal occasions suit invitation; tickets and coupons suit ticket. The designer layouts — focus-window, outline-portrait, triptych (a person) and product-arc (a product) — make the strongest flyers when there is a subject to show: for them, write the first photo query as one close-up subject on a plain or dark background (e.g. "woman portrait dark background", "afrobeats singer portrait studio", "shampoo bottle studio").
- Emphasis: name exactly one word or short phrase from the headline to emphasise (a number for offers).
- Spark: a flyer people stop for has energy — a vivid, specific headline (not a label: "Summer Jazz Night" beats "Jazz Event"), a script or caps eyebrow that sets the mood ("Live", "You're invited", "This weekend only"), and decoration that fits the feeling. Choose the decor level and up to three motifs, best first; the engine places them only in free space, behind the type.
- Give the layout material to design with. Usually: an eyebrow; a subhead that sells the experience or benefit (≤ 10 words); detail lines built from the user's facts (each fact its own line with a fitting icon: date, time, venue, price, dress code); and a short call to action — the user's own words when they gave one ("Buy tickets", "Call to book"), with any link or number kept in contact. Add a body sentence, bullets or features (with icons) only when the user described services, a menu, amenities or reasons to come — restating what they said.
- Facts: use the user's facts verbatim and add none. NEVER invent times (including end times), dates, deadlines ("RSVP by …"), days, prices, discounts, phone numbers, emails, web addresses, street addresses, venues, brand names, numbers, or specific activities, food or amenities the user didn't mention. Leave a field null or a list empty instead; fewer detail lines is fine. Mood and feeling words are welcome ("an evening of soul"), claims are not. Invented facts are removed automatically before the flyer is designed.
- Write in the user's language.

Layout archetypes:
${catalogue(Object.values(ARCHETYPES).map((a) => ({ id: a.id, line: `${a.description} Best for: ${a.bestFor}. Photos used: ${a.photos}.` })))}

Palettes:
${catalogue(Object.values(PALETTES).map((p) => ({ id: p.id, line: `${p.mood}. ${p.psychology} Best for: ${p.bestFor}.` })))}

Type pairings:
${catalogue(Object.values(PAIRINGS).map((p) => ({ id: p.id, line: `${p.mood}. Best for: ${p.bestFor}.` })))}

Decor levels: minimal (corporate, clinical, luxury restraint), balanced (most flyers), bold (parties, sales, kids, sport).

Motifs:
${catalogue(Object.entries(MOTIFS).map(([id, line]) => ({ id, line })))}

Artwork: write it like a brief to a top illustrator — a specific, striking visual idea built from what the user asked for (not a generic stock scene), one named rendering style, the composition with clear space reserved for the type, lighting and texture. No words, letters or copy in it.

Categories and icons are listed in the response schema. Return three different layouts, three palettes and three pairings, best first — they become three distinct design directions. Write photo queries as plain subject words a stock library will match (e.g. "nurses smiling hospital", "thanksgiving dinner table"); return none for purely graphic briefs.`;

const RULES: Omit<Direction, "brief"> = { source: "rules", model: "built-in rules" };

/**
 * Turns a prompt into a design brief. Uses Claude when ANTHROPIC_API_KEY is set,
 * otherwise an open-weight model when LLM_PROVIDER is configured (see open-model.ts),
 * otherwise — or whenever the model is unavailable — the built-in rules.
 */
export async function directDesign(prompt: string, format: FlyerFormat): Promise<Direction> {
  const direction = await direct(prompt, format);
  if (direction.source === "rules") return direction;
  // The policy verdict rides along with the brief — no extra model call — and stops the
  // job before any paid image generation (the route refunds and shows the generic error).
  if (direction.brief.safety.violation) throw new DirectorRefusal(`policy: ${direction.brief.safety.category ?? "violation"}`);
  // Models write vivid copy but sometimes add facts (an end time, an RSVP date): strip
  // anything factual the user didn't say before it reaches a flyer.
  const { brief, removed } = guardFacts(direction.brief, prompt);
  if (removed) console.info(`[director] removed ${removed} invented fact(s) from the ${direction.model} brief`);
  return { ...direction, brief };
}

async function direct(prompt: string, format: FlyerFormat): Promise<Direction> {
  const request = `Flyer format: ${format}.\n\nWhat the user asked for:\n${prompt}`;

  if (process.env.ANTHROPIC_API_KEY) return directWithClaude(prompt, request);

  // Primary provider, then the fallback (LLM_FALLBACK_*), then the rules: rate limits,
  // outages, timeouts and unusable replies degrade instead of failing the generation.
  for (const config of openModelConfigs()) {
    const result = await briefFromOpenModel(config, SYSTEM, request);
    if (result.kind === "brief") return { brief: result.brief, source: "open-model", model: result.model };
    if (result.kind === "refused") throw new DirectorRefusal(result.reason);
    console.error("[director] open model unavailable:", result.reason);
  }
  return { brief: rulesBrief(prompt), ...RULES };
}

async function directWithClaude(prompt: string, request: string): Promise<Direction> {
  const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  try {
    const response = await client.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(BriefSchema) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: request }],
    });

    if (response.stop_reason === "refusal") throw new DirectorRefusal(response.stop_details?.explanation ?? "refused");
    if (!response.parsed_output) throw new Error(`brief did not parse (stop_reason: ${response.stop_reason})`);
    return { brief: response.parsed_output, source: "claude", model: CLAUDE_MODEL };
  } catch (error) {
    if (error instanceof DirectorRefusal) throw error;
    if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
      console.error("[director] Claude unavailable, using rules", error.message);
      return { brief: rulesBrief(prompt), ...RULES };
    }
    throw error;
  }
}
