import { z } from "zod";

import { classifyIntent, extractCopy } from "./prompt";
import { ARCHETYPE_IDS, type ArchetypeId } from "@flyer/design/archetypes";
import { isHex, normalizeHex } from "@flyer/design/color";
import { DECOR_LEVELS, MOTIF_IDS, type Decor, type DecorLevel, type MotifId } from "@flyer/design/decor";
import { ICON_NAMES, type DesignCopy, type IconName } from "@flyer/design/engine";
import { PALETTE_IDS, type PaletteId } from "@flyer/design/palettes";
import { PAIRING_IDS, type PairingId } from "@flyer/design/typography";

/**
 * The art director's output: a design brief. Claude fills it (structured output); the
 * layout engine executes it. Nothing here is pixels — only decisions.
 */

export const CATEGORIES = [
  "corporate",
  "health",
  "recruitment",
  "event",
  "party",
  "sale",
  "real_estate",
  "food",
  "seasonal",
  "education",
  "community",
  "tech",
  "beauty",
  "fitness",
  "travel",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

const icon = z.enum(ICON_NAMES as [IconName, ...IconName[]]);
const nullableText = z.string().nullable();

export const BriefSchema = z.object({
  safety: z
    .object({ violation: z.boolean(), category: nullableText })
    .describe("The content-policy verdict for this request (see the policy in the instructions). violation true stops the design."),
  category: z.enum(CATEGORIES),
  audience: z.string().describe("Who the flyer speaks to, in a few words."),
  tone: z.array(z.string()).describe("Two to four adjectives for the emotional tone."),
  rationale: z
    .string()
    .describe("Two sentences on the design thinking: colour psychology, type voice and why this layout suits the message."),
  copy: z.object({
    brand: nullableText.describe("Organisation or brand name, only if stated or clearly implied."),
    eyebrow: nullableText.describe("A short lead-in above the headline (≤ 4 words), e.g. 'Find your', 'Happy', 'This weekend only'."),
    headline: z.string().describe("The hook, ≤ 6 words. Punchy and specific."),
    emphasis: nullableText.describe("One word or short phrase copied exactly from the headline to emphasise; a number for offers."),
    subhead: nullableText.describe("Supporting line, ≤ 10 words."),
    bodyTitle: nullableText.describe("A section heading such as 'Why choose us?' — only for content-rich flyers."),
    body: nullableText.describe("One or two sentences, ≤ 30 words."),
    bullets: z.array(z.string()).describe("0–4 short items, ≤ 4 words each."),
    features: z
      .array(z.object({ title: z.string(), text: z.string(), icon }))
      .describe("0–3 service/benefit highlights: title ≤ 3 words, text ≤ 14 words."),
    details: z.array(z.object({ icon, text: z.string() })).describe("0–4 logistics lines: date, time, venue, price, dress code."),
    cta: nullableText.describe("Call to action, ≤ 3 words, e.g. 'Book now'."),
    contact: z.object({
      phone: nullableText,
      email: nullableText,
      website: nullableText,
      address: nullableText,
      social: z.array(z.string()),
    }),
  }),
  layouts: z.array(z.enum(ARCHETYPE_IDS)).describe("Three layout archetypes, best first, each different."),
  palettes: z.array(z.enum(PALETTE_IDS)).describe("Three palettes, best first."),
  pairings: z.array(z.enum(PAIRING_IDS)).describe("Three type pairings, best first."),
  decor: z
    .enum(DECOR_LEVELS)
    .describe("How much decoration: minimal (corporate, clinical, luxury restraint), balanced (most flyers), bold (parties, sales, kids, sport)."),
  motifs: z.array(z.enum(MOTIF_IDS)).describe("One to three decorative motifs, best first, that suit the mood."),
  brandColor: nullableText.describe("A hex colour only if the user named a brand colour."),
  colors: z
    .array(z.string())
    .describe("Hex colours the user asked for, named colours converted (e.g. 'navy and gold' → ['#1B2A4A', '#C9A227']); empty if they named none."),
  requirements: z
    .array(z.string())
    .describe("Every explicit instruction in the request — imagery, style, colours, mood, words to include, layout wishes — restated briefly. The design must satisfy each one."),
  artwork: z
    .string()
    .describe(
      "Art direction for the lead design, as you'd brief an illustrator: the subject and imagery the user asked for, the rendering style (e.g. 'bold flat vector illustration', 'cinematic photograph', 'risograph print', 'Swiss modernist poster', 'paper-cut collage', '3D render'), composition and where the type sits, lighting, texture. 1–3 sentences, no copy or words.",
    ),
  photoQueries: z
    .array(z.string())
    .describe("0–3 stock-photo search queries (2–4 plain words each) for the layout's photo frames; empty for purely graphic designs."),
});

export type DesignBrief = z.infer<typeof BriefSchema>;

// ── Normalisation: the engine gets clean, bounded copy whatever the source ───

const clip = (value: string | null | undefined, max: number) => {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : clean;
};

/**
 * A short display line (eyebrow, CTA, section title) is kept whole or not at all:
 * "We can't wait to…" on a button reads as a mistake. Too long → the phrase before the
 * first break ("Come celebrate! We can't wait" → "Come celebrate!"), else nothing.
 */
const phrase = (value: string | null | undefined, max: number) => {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const head = clean.match(/^(.+?[!?.]|.+?)(?=\s*[!?.,;:—–-]\s)/)?.[1]?.trim();
  return head && head.length <= max && /\p{L}{2,}/u.test(head) ? head : null;
};

/** Prose is cut at the last full sentence that fits, falling back to a word-boundary clip. */
const sentences = (value: string | null | undefined, max: number) => {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean || clean.length <= max) return clean || null;
  const fit = clean.slice(0, max).match(/^.*[.!?](?=\s|$)/)?.[0];
  return fit && fit.length > max * 0.4 ? fit : clip(clean, max);
};

export function toDesignCopy(brief: DesignBrief): DesignCopy {
  const c = brief.copy;
  const headline = clip(c.headline, 60) ?? "Your headline";
  const emphasis = clip(c.emphasis, 30);
  return {
    brand: clip(c.brand, 32),
    eyebrow: phrase(c.eyebrow, 32),
    headline,
    // Emphasis must be a phrase that actually appears in the headline.
    emphasis: emphasis && headline.toLowerCase().includes(emphasis.toLowerCase().replace(/[^\p{L}\p{N}%\s]/gu, "").trim()) ? emphasis : null,
    subhead: sentences(c.subhead, 80),
    bodyTitle: phrase(c.bodyTitle, 40),
    body: sentences(c.body, 220),
    bullets: c.bullets.map((b) => phrase(b, 32)).filter((b): b is string => Boolean(b)).slice(0, 4),
    features: c.features
      .map((f) => ({ title: phrase(f.title, 28) ?? "", text: sentences(f.text, 110) ?? "", icon: f.icon }))
      .filter((f) => f.title)
      .slice(0, 3),
    details: c.details.map((d) => ({ icon: d.icon, text: phrase(d.text, 60) ?? "" })).filter((d) => d.text).slice(0, 4),
    // A CTA that can't be shortened cleanly becomes the category's plain one.
    cta: phrase(c.cta, 26) ?? (c.cta ? CATEGORY_CTA[brief.category] : null),
    contact: {
      phone: clip(c.contact.phone, 24),
      email: clip(c.contact.email, 48),
      website: clip(c.contact.website, 48),
      address: clip(c.contact.address, 80),
      // Handles only: the website or email repeated as "social" would print twice.
      social: c.contact.social
        .map((s) => clip(s, 32))
        .filter((s): s is string => Boolean(s) && !sameAddress(s, c.contact.website) && !sameAddress(s, c.contact.email))
        .slice(0, 3),
    },
  };
}

/** Pad the ranked lists so there are always three distinct directions to explore. */
export function rankedChoices(brief: DesignBrief) {
  const defaults = CATEGORY_DEFAULTS[brief.category];
  const pad = <T>(list: T[], fallback: T[]) => [...new Set([...list, ...fallback])].slice(0, 3);
  // Colours the user named win over the palette: the first becomes primary, the second the accent.
  const requested = [...new Set([...brief.colors, brief.brandColor].filter((c): c is string => isHex(c)).map(normalizeHex))];
  return {
    layouts: pad<ArchetypeId>(brief.layouts, defaults.layouts),
    palettes: pad<PaletteId>(brief.palettes, defaults.palettes),
    pairings: pad<PairingId>(brief.pairings, defaults.pairings),
    brandColor: requested[0] ?? null,
    accentColor: requested[1] ?? null,
    decor: { level: brief.decor, motifs: pad<MotifId>(brief.motifs, defaults.motifs) } satisfies Decor,
  };
}

/** Each direction leads with a different motif, so the three variations feel distinct. */
export function decorForVariant(decor: Decor, index: number): Decor {
  const motifs = decor.motifs.length ? [...decor.motifs.slice(index % decor.motifs.length), ...decor.motifs.slice(0, index % decor.motifs.length)] : [];
  return { level: decor.level, motifs };
}

// ── Defaults per category (used to pad choices and for the rules fallback) ───

interface CategoryDefaults {
  palettes: PaletteId[];
  pairings: PairingId[];
  layouts: ArchetypeId[];
  decor: DecorLevel;
  motifs: MotifId[];
}

export const CATEGORY_DEFAULTS: Record<Category, CategoryDefaults> = {
  corporate: { palettes: ["trust-blue", "estate-navy", "noir-mono"], pairings: ["editorial", "refined-serif", "geometric"], layouts: ["editorial-split", "minimal-centre", "geometric-split"], decor: "minimal", motifs: ["dots", "rings", "grid"] },
  health: { palettes: ["fresh-mint", "clinical-red", "trust-blue"], pairings: ["refined-serif", "impact", "editorial"], layouts: ["editorial-split", "minimal-centre", "bold-stack"], decor: "minimal", motifs: ["plus", "dots", "waves"] },
  recruitment: { palettes: ["clinical-red", "trust-blue", "power-orange"], pairings: ["impact", "geometric", "poster-condensed"], layouts: ["outline-portrait", "bold-stack", "diagonal-split"], decor: "balanced", motifs: ["halftone", "plus", "dots"] },
  event: { palettes: ["neon-party", "luxe-gold", "tech-violet"], pairings: ["poster-condensed", "elegant", "tech"], layouts: ["focus-window", "triptych", "ticket"], decor: "balanced", motifs: ["bokeh", "sparkles", "rings"] },
  party: { palettes: ["neon-party", "playful-pop", "luxe-gold"], pairings: ["poster-condensed", "friendly", "romantic"], layouts: ["triptych", "ticket", "big-number"], decor: "bold", motifs: ["confetti", "sparkles", "stars"] },
  sale: { palettes: ["hot-sale", "power-orange", "playful-pop"], pairings: ["impact", "geometric", "poster-condensed"], layouts: ["big-number", "product-arc", "swiss-type"], decor: "bold", motifs: ["stripes", "halftone", "sparkles"] },
  real_estate: { palettes: ["estate-navy", "earth-green", "noir-mono"], pairings: ["refined-serif", "editorial", "geometric"], layouts: ["collage", "geometric-split", "editorial-split"], decor: "minimal", motifs: ["grid", "rings", "dots"] },
  food: { palettes: ["harvest-gold", "espresso", "spring-garden"], pairings: ["elegant", "refined-serif", "friendly"], layouts: ["menu-board", "product-arc", "photo-overlay"], decor: "balanced", motifs: ["leaves", "dots", "blobs"] },
  seasonal: { palettes: ["harvest-gold", "luxe-gold", "spring-garden"], pairings: ["elegant", "romantic", "refined-serif"], layouts: ["photo-overlay", "invitation", "triptych"], decor: "balanced", motifs: ["leaves", "bokeh", "frame"] },
  education: { palettes: ["academic-crimson", "trust-blue", "playful-pop"], pairings: ["refined-serif", "editorial", "friendly"], layouts: ["agenda", "outline-portrait", "editorial-split"], decor: "balanced", motifs: ["stars", "dots", "grid"] },
  community: { palettes: ["spring-garden", "earth-green", "playful-pop"], pairings: ["friendly", "refined-serif", "geometric"], layouts: ["collage", "focus-window", "diagonal-split"], decor: "balanced", motifs: ["blobs", "confetti", "dots"] },
  tech: { palettes: ["tech-violet", "noir-mono", "ocean-coral"], pairings: ["tech", "geometric", "impact"], layouts: ["agenda", "diagonal-split", "swiss-type"], decor: "balanced", motifs: ["grid", "plus", "rings"] },
  beauty: { palettes: ["serene-lavender", "luxe-gold", "noir-mono"], pairings: ["romantic", "elegant", "refined-serif"], layouts: ["product-arc", "focus-window", "magazine-cover"], decor: "balanced", motifs: ["sparkles", "blobs", "frame"] },
  fitness: { palettes: ["power-orange", "hot-sale", "tech-violet"], pairings: ["impact", "poster-condensed", "geometric"], layouts: ["outline-portrait", "diagonal-split", "bold-stack"], decor: "bold", motifs: ["stripes", "halftone", "plus"] },
  travel: { palettes: ["ocean-coral", "earth-green", "spring-garden"], pairings: ["geometric", "elegant", "friendly"], layouts: ["collage", "triptych", "magazine-cover"], decor: "balanced", motifs: ["waves", "blobs", "sparkles"] },
  other: { palettes: ["trust-blue", "noir-mono", "spring-garden"], pairings: ["geometric", "editorial", "impact"], layouts: ["focus-window", "swiss-type", "diagonal-split"], decor: "balanced", motifs: ["dots", "sparkles", "rings"] },
};

/** A visual concept per category for the rules fallback (the subject comes from the prompt). */
const CATEGORY_ARTWORK: Record<Category, (subject: string) => string> = {
  corporate: (s) => `A refined corporate poster about ${s}: clean geometric shapes, confident modern editorial layout with a bold sans-serif headline in generous white space.`,
  health: (s) => `A calm, trustworthy healthcare poster about ${s}: soft natural light, clean shapes and a reassuring, uncluttered layout.`,
  recruitment: (s) => `An energetic recruitment poster about ${s}: dynamic diagonal composition, bold condensed headline, confident people-focused imagery.`,
  event: (s) => `An atmospheric event poster for ${s}: cinematic lighting, rich depth and texture, type set in clear space above the main image.`,
  party: (s) => `A joyful celebration poster for ${s}: playful bold illustration, confetti and balloons, saturated colours, big friendly display type.`,
  sale: (s) => `A high-impact retail sale poster about ${s}: bold graphic shapes, a huge offer number, punchy contrast and energetic composition.`,
  real_estate: (s) => `An elegant real-estate poster for ${s}: architectural photography in golden-hour light, refined serif typography, calm luxurious spacing.`,
  food: (s) => `A mouth-watering food poster for ${s}: overhead styled food photography, warm natural light, appetising textures, elegant type.`,
  seasonal: (s) => `A warm seasonal poster for ${s}: rich seasonal colours and textures, gentle illustration, festive yet elegant typography.`,
  education: (s) => `A bright, inviting education poster about ${s}: friendly illustration, clear structured layout, optimistic colours.`,
  community: (s) => `A warm community poster for ${s}: hand-drawn friendly illustration, people together, inclusive cheerful colours.`,
  tech: (s) => `A sleek technology poster about ${s}: abstract glowing gradients and geometric forms, futuristic minimal layout, crisp sans-serif type.`,
  beauty: (s) => `A luxurious beauty poster for ${s}: soft pastel tones, elegant product-style lighting, refined serif and script typography.`,
  fitness: (s) => `A high-energy fitness poster about ${s}: dramatic action photography, motion and grit, bold condensed type.`,
  travel: (s) => `A dreamy travel poster for ${s}: vintage-modern illustrated landscape, sunlit colours, bold title in the sky area.`,
  other: (s) => `A striking modern poster about ${s}: bold graphic composition, clear hierarchy, confident colours.`,
};

/** "https://www.Example.ng/" and "example.ng" are the same address. */
function sameAddress(a: string | null, b: string | null) {
  const norm = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/.\s]+$/, "");
  return a !== null && b !== null && norm(a) === norm(b);
}

/** A call to action that promises nothing the user didn't say (no tickets, prices or dates). */
const CATEGORY_CTA: Record<Category, string> = {
  corporate: "Get in touch",
  health: "Book a visit",
  recruitment: "Apply now",
  event: "Join us",
  party: "Come celebrate",
  sale: "Shop now",
  real_estate: "Book a viewing",
  food: "Come hungry",
  seasonal: "Join us",
  education: "Learn more",
  community: "Join us",
  tech: "Learn more",
  beauty: "Treat yourself",
  fitness: "Get moving",
  travel: "Explore more",
  other: "Learn more",
};

/** Coarse category stored on generation_jobs (its check constraint predates the design engine). */
export function storedIntent(category: Category): "event" | "sale" | "real_estate" | "party" {
  if (category === "sale") return "sale";
  if (category === "real_estate") return "real_estate";
  if (category === "party" || category === "seasonal") return "party";
  return "event";
}

// ── Rules fallback (no API key, or the director failed) ─────────────────────

export function rulesBrief(prompt: string): DesignBrief {
  const intent = classifyIntent(prompt);
  const category: Category = intent === "real_estate" ? "real_estate" : intent;
  const copy = extractCopy(prompt, intent);
  const defaults = CATEGORY_DEFAULTS[category];
  const price = prompt.match(/[$€£]\s?\d+(?:[.,]\d{2})?/)?.[0];
  // A time or range: "8pm", "10:30am", "1–4pm", "10am - 6pm".
  const time = prompt.match(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)?\s?[–-]\s?\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i)?.[0];
  const day = prompt.match(/\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i)?.[0];
  // Logistics get their own detail rows, unless the headline already says them.
  const fresh = (token: string | undefined): token is string => Boolean(token) && !copy.headline.toLowerCase().includes(token!.toLowerCase());
  const when = [day, time].filter(fresh);
  const details = [
    when.length ? { icon: "calendar" as IconName, text: when.join(", ") } : null,
    fresh(price) ? { icon: "ticket" as IconName, text: price } : null,
  ].filter((d): d is { icon: IconName; text: string } => Boolean(d));
  const subhead = withoutLogistics(copy.details, [day, time, price].filter((t): t is string => Boolean(t)));
  return {
    safety: { violation: false, category: null },
    category,
    audience: "general public",
    tone: [],
    rationale: "Composed by the built-in rules: palette, type and layout chosen from the flyer's category.",
    copy: {
      brand: null,
      eyebrow: copy.tagline,
      headline: copy.headline,
      emphasis: intent === "sale" ? copy.headline.split(" ")[0] ?? null : null,
      subhead: subhead || null,
      bodyTitle: null,
      body: null,
      bullets: [],
      features: [],
      details,
      cta: CATEGORY_CTA[category],
      contact: { phone: null, email: null, website: null, address: null, social: [] },
    },
    layouts: defaults.layouts,
    palettes: defaults.palettes,
    pairings: defaults.pairings,
    decor: defaults.decor,
    motifs: defaults.motifs,
    brandColor: null,
    colors: [],
    requirements: [],
    artwork: CATEGORY_ARTWORK[category](rulesPhotoQueries(prompt, category)[0] ?? category.replace("_", " ")),
    photoQueries: rulesPhotoQueries(prompt, category),
  };
}

const LOGISTICS_FILLER = /\b(?:tickets?|entry|admission|doors|from|at|on|starts?|only)\b/gi;

/**
 * The subline without the day, time and price (they're shown as detail rows), so the
 * flyer never says the same thing twice: "The Blue Room · Friday 8pm · Tickets $15"
 * → "The Blue Room".
 */
function withoutLogistics(line: string, tokens: string[]) {
  return line
    .split("·")
    .map((clause) => {
      let rest = clause;
      for (const token of tokens) rest = rest.replace(token, " ");
      if (rest === clause) return clause.trim();
      rest = rest.replace(/\s+/g, " ").replace(/^[\s,–-]+|[\s,–-]+$/g, "");
      if (!/\p{L}{2,}/u.test(rest.replace(LOGISTICS_FILLER, ""))) return "";
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    })
    .filter(Boolean)
    .join("  ·  ");
}

/** A subject that reliably returns good stock photography for each category. */
const CATEGORY_PHOTO_QUERY: Record<Category, string> = {
  corporate: "modern office team",
  health: "doctor patient care",
  recruitment: "smiling professional at work",
  event: "event crowd stage lights",
  party: "party celebration confetti",
  sale: "fashion boutique shopping",
  real_estate: "modern house exterior",
  food: "restaurant food table",
  seasonal: "autumn table dinner",
  education: "students classroom learning",
  community: "community volunteers outdoors",
  tech: "technology workspace laptop",
  beauty: "beauty skincare spa",
  fitness: "gym workout training",
  travel: "travel landscape adventure",
  other: "people smiling outdoors",
};

const QUERY_STOP_WORDS = new Set(
  ("a an and are at be by for from in is it of on or our the this that to we with you your " +
    "flyer poster ad banner post invite invitation create make design need want please " +
    "ticket tickets entry free off everything everyone all new now only today tonight weekend week " +
    "next join come turning years year old bed beds bath baths sq ft st street road ave avenue " +
    "am pm noon midnight").split(" "),
);
const DATE_WORDS =
  /^(?:mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(?:day)?$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/i;

/**
 * Stock-photo searches for the rules fallback: the prompt's subject words (dropping
 * logistics, numbers and proper nouns like venue or brand names, which make poor
 * searches), then a dependable query for the category.
 */
export function rulesPhotoQueries(prompt: string, category: Category): string[] {
  const words = prompt
    .replace(/[$€£]\s?\d+(?:[.,]\d+)?/g, " ")
    .split(/[^\p{L}\p{N}'&%–-]+/u)
    .filter(Boolean);
  const subject = words
    .filter((word, i) => !(i > 0 && /^\p{Lu}/u.test(word))) // proper nouns mid-sentence
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 2 && !QUERY_STOP_WORDS.has(word) && !DATE_WORDS.test(word) && !/\d/.test(word))
    .slice(0, 3)
    .join(" ");
  return [subject, CATEGORY_PHOTO_QUERY[category]].filter(Boolean);
}
