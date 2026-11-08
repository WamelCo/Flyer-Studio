import { z } from "zod";

import { classifyIntent, extractCopy } from "../ai/prompt";
import { ARCHETYPE_IDS, type ArchetypeId } from "./archetypes";
import { isHex, normalizeHex } from "./color";
import { DECOR_LEVELS, MOTIF_IDS, type Decor, type DecorLevel, type MotifId } from "./decor";
import { ICON_NAMES, type DesignCopy, type IconName } from "./engine";
import { PALETTE_IDS, type PaletteId } from "./palettes";
import { PAIRING_IDS, type PairingId } from "./typography";

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
      social: c.contact.social.map((s) => clip(s, 32)).filter((s): s is string => Boolean(s)).slice(0, 3),
    },
  };
}

/** Pad the ranked lists so there are always three distinct directions to explore. */
export function rankedChoices(brief: DesignBrief) {
  const defaults = CATEGORY_DEFAULTS[brief.category];
  const pad = <T>(list: T[], fallback: T[]) => [...new Set([...list, ...fallback])].slice(0, 3);
  return {
    layouts: pad<ArchetypeId>(brief.layouts, defaults.layouts),
    palettes: pad<PaletteId>(brief.palettes, defaults.palettes),
    pairings: pad<PairingId>(brief.pairings, defaults.pairings),
    brandColor: isHex(brief.brandColor) ? normalizeHex(brief.brandColor) : null,
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
  corporate: { palettes: ["trust-blue", "estate-navy", "noir-mono"], pairings: ["editorial", "refined-serif", "geometric"], layouts: ["editorial-split", "geometric-split", "swiss-type"], decor: "minimal", motifs: ["dots", "rings", "grid"] },
  health: { palettes: ["fresh-mint", "clinical-red", "trust-blue"], pairings: ["refined-serif", "impact", "editorial"], layouts: ["editorial-split", "bold-stack", "swiss-type"], decor: "minimal", motifs: ["plus", "dots", "waves"] },
  recruitment: { palettes: ["clinical-red", "trust-blue", "power-orange"], pairings: ["impact", "geometric", "poster-condensed"], layouts: ["bold-stack", "editorial-split", "swiss-type"], decor: "balanced", motifs: ["halftone", "plus", "dots"] },
  event: { palettes: ["neon-party", "luxe-gold", "tech-violet"], pairings: ["poster-condensed", "elegant", "tech"], layouts: ["photo-overlay", "swiss-type", "bold-stack"], decor: "balanced", motifs: ["bokeh", "sparkles", "rings"] },
  party: { palettes: ["neon-party", "playful-pop", "luxe-gold"], pairings: ["poster-condensed", "friendly", "romantic"], layouts: ["photo-overlay", "swiss-type", "bold-stack"], decor: "bold", motifs: ["confetti", "sparkles", "stars"] },
  sale: { palettes: ["hot-sale", "power-orange", "playful-pop"], pairings: ["impact", "geometric", "poster-condensed"], layouts: ["swiss-type", "bold-stack", "photo-overlay"], decor: "bold", motifs: ["stripes", "halftone", "sparkles"] },
  real_estate: { palettes: ["estate-navy", "earth-green", "noir-mono"], pairings: ["refined-serif", "editorial", "geometric"], layouts: ["geometric-split", "editorial-split", "photo-overlay"], decor: "minimal", motifs: ["grid", "rings", "dots"] },
  food: { palettes: ["harvest-gold", "espresso", "spring-garden"], pairings: ["elegant", "refined-serif", "friendly"], layouts: ["photo-overlay", "editorial-split", "swiss-type"], decor: "balanced", motifs: ["leaves", "dots", "blobs"] },
  seasonal: { palettes: ["harvest-gold", "luxe-gold", "spring-garden"], pairings: ["elegant", "romantic", "refined-serif"], layouts: ["photo-overlay", "swiss-type", "geometric-split"], decor: "balanced", motifs: ["leaves", "bokeh", "frame"] },
  education: { palettes: ["academic-crimson", "trust-blue", "playful-pop"], pairings: ["refined-serif", "editorial", "friendly"], layouts: ["editorial-split", "swiss-type", "bold-stack"], decor: "balanced", motifs: ["stars", "dots", "grid"] },
  community: { palettes: ["spring-garden", "earth-green", "playful-pop"], pairings: ["friendly", "refined-serif", "geometric"], layouts: ["photo-overlay", "editorial-split", "swiss-type"], decor: "balanced", motifs: ["blobs", "confetti", "dots"] },
  tech: { palettes: ["tech-violet", "noir-mono", "ocean-coral"], pairings: ["tech", "geometric", "impact"], layouts: ["swiss-type", "geometric-split", "editorial-split"], decor: "balanced", motifs: ["grid", "plus", "rings"] },
  beauty: { palettes: ["serene-lavender", "luxe-gold", "noir-mono"], pairings: ["romantic", "elegant", "refined-serif"], layouts: ["photo-overlay", "geometric-split", "editorial-split"], decor: "balanced", motifs: ["sparkles", "blobs", "frame"] },
  fitness: { palettes: ["power-orange", "hot-sale", "tech-violet"], pairings: ["impact", "poster-condensed", "geometric"], layouts: ["bold-stack", "swiss-type", "photo-overlay"], decor: "bold", motifs: ["stripes", "halftone", "plus"] },
  travel: { palettes: ["ocean-coral", "earth-green", "spring-garden"], pairings: ["geometric", "elegant", "friendly"], layouts: ["photo-overlay", "geometric-split", "editorial-split"], decor: "balanced", motifs: ["waves", "blobs", "sparkles"] },
  other: { palettes: ["trust-blue", "noir-mono", "spring-garden"], pairings: ["geometric", "editorial", "impact"], layouts: ["swiss-type", "editorial-split", "photo-overlay"], decor: "balanced", motifs: ["dots", "sparkles", "rings"] },
};

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

/** A lead-in that fits the category and claims nothing (rules path; models write their own). */
const CATEGORY_EYEBROW: Partial<Record<Category, string>> = {
  corporate: "At your service",
  health: "Your health first",
  recruitment: "We're hiring",
  food: "Now serving",
  education: "Learn with us",
  community: "All are welcome",
  tech: "Fast & reliable",
  beauty: "Look your best",
  fitness: "Get moving",
  travel: "Explore",
  seasonal: "Celebrate",
  sale: "Special offers",
  party: "You're invited",
  real_estate: "Just listed",
};

/** Farm inputs use food's palettes (above) but not its restaurant lead-in. */
const FARM_INPUTS = /\b(chicks|poultry|broilers?|layers|fertili[sz]ers?|seed maize|stock ?feed|farm inputs|agro)\b/i;

/** Coarse category stored on generation_jobs (its check constraint predates the design engine). */
export function storedIntent(category: Category): "event" | "sale" | "real_estate" | "party" {
  if (category === "sale") return "sale";
  if (category === "real_estate") return "real_estate";
  if (category === "party" || category === "seasonal") return "party";
  return "event";
}

// ── Rules fallback (no API key, or the director failed) ─────────────────────

/**
 * Contact details the user stated, lifted out before the prompt is split into clauses —
 * the splitter breaks on "." and would turn "lotusyoga.com" into "Lotusyoga · Com".
 */
/**
 * Phone numbers as people write them: Zimbabwean mobiles and landlines ("0772 145 682",
 * "+263 71 233 0918", "020 2061 345"), and international or US-style formats.
 */
const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\b\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b|\+\d{1,3}[\s.-]?\d{2,3}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function extractContact(prompt: string) {
  const email = prompt.match(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/)?.[0] ?? null;
  const withoutEmail = email ? prompt.replace(email, " ") : prompt;
  const website = withoutEmail.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s,]*)?\b/i)?.[0] ?? null;
  // Prices aren't phone numbers ("US$1,200"); only digit runs long enough to dial.
  const phones = [...withoutEmail.matchAll(PHONE_PATTERN)]
    .map((match) => ({ value: match[0].trim(), index: match.index ?? 0 }))
    .filter(({ value, index }) => value.replace(/\D/g, "").length >= 9 && !/[$€£]\s*$|zig\s*$/i.test(withoutEmail.slice(Math.max(0, index - 5), index)));
  // A number the user labelled WhatsApp keeps the label — the main channel for many businesses.
  const labelled = phones.map(({ value, index }) => ({
    value,
    whatsapp: /whats\s?app\s*(?:us\s*)?(?:on\s*)?:?\s*$/i.test(withoutEmail.slice(Math.max(0, index - 16), index)),
  }));
  const primary = labelled.find((p) => p.whatsapp) ?? labelled[0] ?? null;
  const others = labelled.filter((p) => p !== primary);

  let rest = prompt;
  for (const value of [email, website, ...phones.map((p) => p.value)]) {
    // Lead-ins go with the number: "orders on WhatsApp 0783…", "or call +263…".
    if (value) rest = rest.replace(new RegExp(`(?:,?\\s*(?:(?:orders?|bookings?|enquiries|call|phone|sms|whats\\s?app(?:\\s+us)?|email|visit|via|at|on|or)\\s*:?\\s+)+)?${escapeRegExp(value)}`, "i"), " ");
  }
  rest = rest.replace(/\b(?:or|and)\s*(?=[,.;]|$)/gi, " ");
  return {
    email,
    website,
    phone: primary ? `${primary.whatsapp ? "WhatsApp " : ""}${primary.value}` : null,
    otherPhones: others.map((p) => `${p.whatsapp ? "WhatsApp" : "Call"} ${p.value}`),
    whatsapp: labelled.some((p) => p.whatsapp) || /whats\s?app/i.test(prompt),
    rest: rest.replace(/\s+([,.;])/g, "$1").replace(/(?:[,;]\s*){2,}/g, ", ").replace(/[,\s]+$/, "").trim(),
  };
}

/**
 * The category from what the business does — the engine has palettes, type and layouts
 * tuned for each. Order matters: the first match wins. Null falls back to the intent.
 */
const CATEGORY_KEYWORDS: [Category, RegExp][] = [
  ["real_estate", /\b(open house|for rent|to let|for lease|just listed|real estate|apartment|bedroom|stands? for sale|residential stands?|plots?|property|house for sale|rooms? to rent)\b/i],
  ["recruitment", /\b(hiring|vacanc(?:y|ies)|we'?re recruiting|job openings?|apply now|now recruiting)\b/i],
  ["education", /(?<!back to )\b(school|enrol(?:l)?(?:ing|ment)?|tuition|tutoring|lessons|academy|college|driving school|training (?:course|centre|center)|form [1-6]|ecd|o ?level|a ?level|courses?)\b/i],
  ["health", /\b(clinic|pharmacy|chemist|doctor|dental|dentist|medical|optometrist|hospital|wellness centre)\b/i],
  ["beauty", /\b(salon|hair|braids?|nails?|barber(?:shop)?|make-?up|spa|lashes|wigs?|beauty|cosmetics)\b/i],
  ["fitness", /\b(gym|yoga|fitness|workout|bootcamp|aerobics|personal trainer|zumba)\b/i],
  ["food", /\b(restaurant|kitchen|takeaways?|sadza|braai|shisa nyama|bakery|cafe|café|catering|menu|pizza|pizzeria|grill|food|lunch|dinner|breakfast|butchery)\b/i],
  // Farm inputs share food's earthy palettes and leaf motifs.
  ["food", /\b(chicks|poultry|broilers?|layers|fertili[sz]ers?|seed maize|stock ?feed|farm inputs|agro)\b/i],
  ["tech", /\b(phone repairs?|screen repairs?|laptops?|software|app launch|internet|wi-?fi|computers?|cctv|solar|inverters?|electronics)\b/i],
  ["travel", /\b(tours?|travel|safari|flights?|holiday packages?|lodge)\b/i],
  ["community", /\b(church|crusade|revival|prayer|gospel|fundraiser|ministry|congregation|youth camp|community)\b/i],
  ["seasonal", /\b(christmas|easter|thanksgiving|independence day|heroes day|new year)\b/i],
  ["party", /\b(party|birthday|celebration|wedding|anniversary|bridal shower|baby shower)\b/i],
  ["sale", /\b(sale|specials?|discount|deals?|clearance|promo(?:tion)?|% ?off|wholesale prices?)\b|\d+ ?%/i],
  ["corporate", /\b(consult(?:ing|ancy)?|accounting|legal|insurance|logistics|construction|hardware|plumbing|electrical|cleaning services)\b/i],
];

function classifyCategory(prompt: string): Category | null {
  return CATEGORY_KEYWORDS.find(([, pattern]) => pattern.test(prompt))?.[0] ?? null;
}

export function rulesBrief(prompt: string): DesignBrief {
  const intent = classifyIntent(prompt);
  const category: Category = classifyCategory(prompt) ?? (intent === "real_estate" ? "real_estate" : intent);
  const contact = extractContact(prompt);
  const copy = extractCopy(contact.rest || prompt, intent);
  const defaults = CATEGORY_DEFAULTS[category];
  // US$ / $ / € / £ and ZiG, with thousands separators: "US$1,200", "ZiG 31,000".
  const priceMatch = /(?:US\$|[$€£])\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\bZiG\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/i.exec(prompt);
  const price = priceMatch?.[0];
  // "from US$1,200" is a starting price, not the price.
  const priceText = price && /\bfrom\s*$/i.test(prompt.slice(0, priceMatch!.index)) ? `From ${price}` : price;
  // A time or range: "8pm", "10:30am", "1–4pm", "10am - 6pm".
  const time = prompt.match(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)?\s?[–-]\s?\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i)?.[0];
  // A day or a range of days: "Saturday", "Monday to Saturday".
  const dayName = String.raw`(?:mon|tues|wednes|thurs|fri|satur|sun)day`;
  const day = prompt.match(new RegExp(String.raw`\b${dayName}(?:\s*(?:to|through|-|–)\s*${dayName})?\b`, "i"))?.[0];
  // A calendar date: "14 March", "March 14".
  const month = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*`;
  const date = prompt.match(new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${month}\b|\b${month}\s+\d{1,2}(?:st|nd|rd|th)?\b`, "i"))?.[0];
  // Logistics get their own detail rows, unless the headline already says them.
  const fresh = (token: string | undefined): token is string => Boolean(token) && !copy.headline.toLowerCase().includes(token!.toLowerCase());
  const when = [[day, date].filter(fresh).join(" "), time].filter((part): part is string => Boolean(part) && fresh(part));
  const details = [
    when.length ? { icon: "calendar" as IconName, text: when.join(", ") } : null,
    fresh(price) ? { icon: "ticket" as IconName, text: priceText! } : null,
    ...contact.otherPhones.map((text) => ({ icon: "phone" as IconName, text })),
  ].filter((d): d is { icon: IconName; text: string } => Boolean(d));
  const subhead = withoutLogistics(copy.details, [day, date, time, price].filter((t): t is string => Boolean(t)));
  return {
    category,
    audience: "general public",
    tone: [],
    rationale: "Composed by the built-in rules: palette, type and layout chosen from the flyer's category.",
    copy: {
      brand: null,
      eyebrow: FARM_INPUTS.test(prompt) ? "Order today" : (CATEGORY_EYEBROW[category] ?? copy.tagline),
      headline: copy.headline,
      emphasis: intent === "sale" ? copy.headline.split(" ")[0] ?? null : null,
      subhead: subhead || null,
      bodyTitle: null,
      body: null,
      bullets: [],
      features: [],
      details,
      cta: contact.whatsapp ? "WhatsApp us" : CATEGORY_CTA[category],
      contact: { phone: contact.phone, email: contact.email, website: contact.website, address: null, social: [] },
    },
    layouts: defaults.layouts,
    palettes: defaults.palettes,
    pairings: defaults.pairings,
    decor: defaults.decor,
    motifs: defaults.motifs,
    brandColor: null,
    photoQueries: rulesPhotoQueries(prompt, category),
  };
}

const LOGISTICS_FILLER = /\b(?:tickets?|entry|admission|doors|from|at|on|starts?|only|open|daily)\b/gi;

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
      for (const token of tokens) rest = rest.replace(token, " § ");
      if (rest === clause) return clause.trim();
      // Connectives that pointed at a removed token go with it: "every Saturday at 7am" → "".
      for (let pass = 0; pass < 3; pass++) rest = rest.replace(/\b(?:every|each|at|on|from|this|next|starting|starts|until)\s*(?=§)/gi, "");
      rest = rest.replace(/§/g, " ");
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
