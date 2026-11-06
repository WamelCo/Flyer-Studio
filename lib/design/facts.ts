import type { DesignBrief } from "@/lib/design/brief";

/**
 * The "never invent facts" rule, enforced in code. Models write vivid copy, but a flyer
 * with an invented end time, RSVP deadline, price or phone number misleads the people
 * who read it. Every factual token in the brief — times, days, dates, prices,
 * percentages, phone numbers, emails, web addresses and bare numbers — must be traceable
 * to the user's prompt; anything that isn't is removed: the phrase from a short line,
 * the sentence from body copy, the whole row from details and lists.
 */

// Full day names only: "sun", "sat" and "wed" are ordinary words too.
const DAY = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b/gi;
const MONTH_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi;
const ORDINAL = /\b\d{1,2}(?:st|nd|rd|th)\b/gi;
const NUMERIC_DATE = /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g;
const TIME = /\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\b\d{1,2}:\d{2}\b|\b(?:noon|midnight)\b/gi;
const PRICE = /[$€£¥₦]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:usd|eur|gbp|dollars?|euros?|pounds?|naira)\b|\bfree\s+(?:entry|admission|tickets?|for\s+all|of\s+charge|to\s+attend)\b/gi;
const PERCENT = /\b\d+(?:\.\d+)?\s?%/g;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|shop|store|biz|info)(?:\/\S*)?\b/gi;
const NUMBER = /\b\d+(?:[.,]\d+)?\b/g;

const PATTERNS = [EMAIL, URL, PHONE, PRICE, PERCENT, MONTH_DATE, NUMERIC_DATE, TIME, ORDINAL, DAY, NUMBER];

/** Canonical form, so "2:00 PM", "2pm" and "2 p.m." all compare equal. */
function canon(token: string) {
  return token
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(/:00(?=am|pm)/, "")
    .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*day[s]?$/, "$1")
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/[(),-]/g, "");
}

function tokens(text: string) {
  const found: string[] = [];
  let rest = text;
  for (const pattern of PATTERNS) {
    rest = rest.replace(pattern, (match) => {
      found.push(match);
      return " ".repeat(match.length); // a phone number's digits aren't also bare numbers
    });
  }
  return found;
}

export interface FactSource {
  canon: Set<string>;
  numbers: Set<string>;
}

/** Everything the user actually stated, in canonical form. */
export function factSource(prompt: string): FactSource {
  const canonSet = new Set(tokens(prompt).map(canon));
  // "1–4pm" states both 1pm and 4pm.
  for (const range of prompt.matchAll(/\b(\d{1,2})(?::\d{2})?\s?[–-]\s?(\d{1,2})(?::\d{2})?\s?(am|pm)\b/gi)) {
    canonSet.add(`${range[1]}${range[3]!.toLowerCase()}`);
    canonSet.add(`${range[2]}${range[3]!.toLowerCase()}`);
  }
  const numbers = new Set([...prompt.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", ".")));
  return { canon: canonSet, numbers };
}

function supported(token: string, source: FactSource) {
  const c = canon(token);
  if (source.canon.has(c)) return true;
  // A time or price is supported when its numbers are (e.g. "8 PM" from "8pm", "$15.00" from "$15").
  const digits = token.match(/\d+(?:[.,]\d+)?/g);
  if (/^\d+(?:[.,]\d+)?$/.test(token)) return source.numbers.has(token.replace(",", "."));
  // "6th birthday" is stated by "turning 6".
  if (/^\d+(?:st|nd|rd|th)$/i.test(token)) return source.numbers.has(digits![0]!);
  if (digits && /am|pm|[$€£¥₦]|%/i.test(token)) {
    const unit = (token.match(/am|pm|[$€£¥₦]|%/i)?.[0] ?? "").toLowerCase();
    const value = digits[0]!.replace(/\.0+$/, "").replace(",", ".");
    return source.canon.has(unit === "am" || unit === "pm" ? `${value}${unit}` : unit === "%" ? `${value}%` : `${unit}${value}`) || [...source.canon].some((s) => s.includes(value) && s.includes(unit));
  }
  return false;
}

/** The unsupported factual tokens in a piece of copy. */
export function unsupported(text: string, source: FactSource) {
  return tokens(text).filter((token) => !supported(token, source));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes each unsupported token with the little phrase that introduces it ("by Thursday", "until 5pm"). */
function stripPhrases(text: string, bad: string[]) {
  let out = text;
  for (const token of bad) {
    out = out.replace(new RegExp(`\\s*(?:\\b(?:by|until|till|from|on|at|before|after|starting|starts|ends|doors|every)\\b\\s*)?${escape(token)}`, "i"), "");
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s,.;:·–-]+|[\s,;:·–-]+$/g, "").trim();
}

/** A short line: strip the invented phrase; drop the line if little is left. */
function cleanLine(text: string | null, source: FactSource): string | null {
  if (!text) return text;
  const bad = unsupported(text, source);
  if (!bad.length) return text;
  const cleaned = stripPhrases(text, bad);
  return /\p{L}{2,}/u.test(cleaned) ? cleaned : null;
}

/** Body copy: drop the sentences that carry invented facts. */
function cleanProse(text: string | null, source: FactSource): string | null {
  if (!text) return text;
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const kept = sentences.filter((s) => !unsupported(s, source).length).join("").trim();
  return kept || null;
}

const keepIfClean = (text: string, source: FactSource) => !unsupported(text, source).length;

const PART_OF_DAY = /\b(morning|afternoon|evening|night|tonight)\b/gi;

/** The part of day the user's first stated time falls in ("2pm" → afternoon), if any. */
function statedPartOfDay(prompt: string) {
  const time = prompt.match(/\b(\d{1,2})(?::\d{2})?\s?(?:[–-]\s?\d{1,2}(?::\d{2})?\s?)?(am|pm)\b/i);
  if (!time) return null;
  let hour = Number(time[1]) % 12;
  if (time[2]!.toLowerCase() === "pm") hour += 12;
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
}

/** "A magical morning" for a 2pm party → "A magical afternoon". Night-ish words stay together. */
function fixPartOfDay(text: string | null, actual: string | null) {
  if (!text || !actual) return text;
  return text.replace(PART_OF_DAY, (word) => {
    const said = word.toLowerCase();
    const compatible = said === actual || (actual === "evening" && (said === "night" || said === "tonight")) || (actual === "night" && (said === "evening" || said === "tonight"));
    if (compatible) return word;
    return word[0] === word[0]!.toUpperCase() ? actual[0]!.toUpperCase() + actual.slice(1) : actual;
  });
}

/** Contact details must appear in the prompt verbatim (ignoring spacing and punctuation). */
function stated(value: string | null, prompt: string) {
  if (!value) return null;
  const flat = (s: string) => s.toLowerCase().replace(/[\s().-]/g, "");
  return flat(prompt).includes(flat(value).replace(/^(https?:\/\/)?(www\.)?/, "")) ? value : null;
}

export function guardFacts(brief: DesignBrief, prompt: string): { brief: DesignBrief; removed: number } {
  const source = factSource(prompt);
  const c = brief.copy;
  let removed = 0;
  const track = <T>(before: T, after: T) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) removed++;
    return after;
  };

  const copy: DesignBrief["copy"] = {
    ...c,
    headline: track(c.headline, cleanLine(c.headline, source) ?? c.headline),
    eyebrow: track(c.eyebrow, cleanLine(c.eyebrow, source)),
    emphasis: c.emphasis,
    subhead: track(c.subhead, cleanLine(c.subhead, source)),
    bodyTitle: track(c.bodyTitle, cleanLine(c.bodyTitle, source)),
    body: track(c.body, cleanProse(c.body, source)),
    bullets: track(c.bullets, c.bullets.filter((b) => keepIfClean(b, source))),
    features: track(
      c.features,
      c.features.filter((f) => keepIfClean(f.title, source)).map((f) => ({ ...f, text: cleanProse(f.text, source) ?? "" })),
    ),
    details: track(c.details, c.details.filter((d) => keepIfClean(d.text, source))),
    cta: track(c.cta, cleanLine(c.cta, source)),
    contact: {
      phone: track(c.contact.phone, stated(c.contact.phone, prompt)),
      email: track(c.contact.email, stated(c.contact.email, prompt)),
      website: track(c.contact.website, stated(c.contact.website, prompt)),
      address: track(c.contact.address, stated(c.contact.address, prompt)),
      social: track(c.contact.social, c.contact.social.filter((s) => stated(s, prompt))),
    },
  };
  // Mood words mustn't contradict the stated time.
  const partOfDay = statedPartOfDay(prompt);
  for (const key of ["headline", "eyebrow", "subhead", "body"] as const) {
    const fixed = fixPartOfDay(copy[key], partOfDay);
    if (fixed !== copy[key]) {
      removed++;
      if (key === "headline") copy.headline = fixed ?? copy.headline;
      else copy[key] = fixed;
    }
  }
  // Emphasis must still appear in the (possibly cleaned) headline.
  if (copy.emphasis && !copy.headline.toLowerCase().includes(copy.emphasis.toLowerCase())) copy.emphasis = null;
  return { brief: { ...brief, copy }, removed };
}
