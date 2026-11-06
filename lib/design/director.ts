import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import type { FlyerFormat } from "@/lib/canvas/types";
import { ARCHETYPES } from "@/lib/design/archetypes";
import { BriefSchema, rulesBrief, type DesignBrief } from "@/lib/design/brief";
import { MOTIFS } from "@/lib/design/decor";
import { guardFacts } from "@/lib/design/facts";
import { briefFromOpenModel, openModelConfigs } from "@/lib/design/open-model";
import { PALETTES } from "@/lib/design/palettes";
import { PAIRINGS } from "@/lib/design/typography";

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
export const SYSTEM = `You are the art director of a flyer design studio. A layout engine executes your decisions exactly, placing type, shapes, icons and photo frames on a grid — so you decide, you never draw. You do not generate images; photography comes from stock search.

Think like a senior graphic designer:
- Hierarchy: one dominant headline (≤ 6 words), an optional eyebrow and subhead, then supporting copy. Fewer, sharper words beat more words.
- Colour psychology: pick palettes whose meaning matches the message and audience.
- Typography: pick pairings whose voice matches the tone; display faces for impact, serifs for trust and elegance, script only for warmth or celebration.
- Layout: pick archetypes whose structure suits the content — content-rich messages need room for sections; emotional ones want a big photograph; offers want the number to dominate.
- Emphasis: name exactly one word or short phrase from the headline to emphasise (a number for offers).
- Spark: a flyer people stop for has energy — a vivid, specific headline (not a label: "Summer Jazz Night" beats "Jazz Event"), a script or caps eyebrow that sets the mood ("Live", "You're invited", "This weekend only"), and decoration that fits the feeling. Choose the decor level and up to three motifs, best first; the engine places them only in free space, behind the type.
- Give the layout material to design with. Usually: an eyebrow; a subhead that sells the experience or benefit (≤ 10 words); detail lines built from the user's facts (each fact its own line with a fitting icon: date, time, venue, price, dress code); and a short call to action. Add a body sentence, bullets or features (with icons) only when the user described services, a menu, amenities or reasons to come — restating what they said.
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
