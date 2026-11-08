/**
 * Prompt handling (see .claude/rules/ai-generation.md): sanitising, a keyword intent
 * classifier and copy extraction — the rules fallback when the art director is unavailable.
 */

export const MAX_PROMPT_LENGTH = 500;

export type FlyerIntent = "event" | "sale" | "real_estate" | "party";

export function sanitizePrompt(input: string) {
  return input
    .replace(/<[^>]*>/g, " ") // strip HTML tags
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROMPT_LENGTH);
}

const INTENT_KEYWORDS: [FlyerIntent, RegExp][] = [
  [
    "real_estate",
    /\b(open house|for rent|for lease|just listed|listing|realtor|real estate|apartment|condo|bedroom|bathroom|sq ?ft|property|home for sale|house for sale)\b/i,
  ],
  ["sale", /\b(sale|% ?off|discount|deal|clearance|promo|offer|bogo|black friday|cyber monday|shop|store opening)\b|\d+ ?%/i],
  ["party", /\b(party|birthday|bday|celebration|bash|shower|anniversary|halloween|new year|nye|rave|fiesta|wedding)\b/i],
];

export function classifyIntent(prompt: string): FlyerIntent {
  return INTENT_KEYWORDS.find(([, pattern]) => pattern.test(prompt))?.[0] ?? "event";
}

// ── Copy extraction ──────────────────────────────────────────────────────────

export interface FlyerCopy {
  tagline: string;
  headline: string;
  details: string;
}

const TAGLINES: Record<FlyerIntent, string> = {
  event: "Join us",
  sale: "Limited time",
  real_estate: "Just listed",
  party: "You're invited",
};

const LEAD_INS =
  /^(please\s+)?((create|make|design|generate|build|i need|i want|we need)\s+)?(me\s+)?((a|an|the)\s+)?((flyer|poster|ad|advert|banner|post|graphic|invite|invitation)\s+(for|about|announcing|advertising)\s+)?((a|an|the|our|my)\s+)?/i;

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

function titleCase(text: string) {
  return text
    .split(" ")
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : // Acronyms, numbers and brand casing (FixIt, iPhone, eBay) stay as written.
          /[A-Z]{2,}|\d|.\p{Lu}/u.test(word)
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

export function extractCopy(prompt: string, intent: FlyerIntent): FlyerCopy {
  const clauses = prompt
    .replace(LEAD_INS, "")
    // Commas and dots split clauses, but not inside numbers: "US$1,200", "3.5kVA".
    // A question ends its clause and keeps its mark: "Cracked screen?" is a headline.
    .split(/(?<!\d),|,(?!\d)|(?<!\d)\.|\.(?!\d)|[;\n]|\s[-–—]\s|(?<=\?)\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  let [first = "Your headline", ...rest] = clauses;

  // "Jazz night at the Blue Room" → headline "Jazz Night", details "The Blue Room"
  const venue = first.match(/^(.{3,}?)\s+(at|@|in)\s+(.+)$/i);
  if (venue?.[1] && venue[3]) {
    first = venue[1];
    rest = [venue[3], ...rest];
  }
  // Headlines stay short: "Kids birthday party for Mia turning 6" → "Kids Birthday Party" + "For Mia turning 6".
  const tail = first.split(" ").length > 5 ? first.match(/^(.{3,}?)\s+((?:for|with|on|featuring|this|next)\s+.+)$/i) : null;
  if (tail?.[1] && tail[2]) {
    first = tail[1];
    rest = [tail[2], ...rest];
  }

  const discount = intent === "sale" ? prompt.match(/\b\d{1,2} ?% ?off\b/i)?.[0] : undefined;
  const words = first.split(" ");
  const headline = discount
    ? discount.toUpperCase().replace(/\s+/g, " ")
    : titleCase(words.slice(0, 6).join(" "));

  // For sales the discount becomes the headline; what is discounted moves to the details.
  const remainder = discount ? first.replace(discount, "").trim() : "";
  const details = (remainder ? [remainder, ...rest] : rest)
    // Capitalise the clause, but leave brand casing alone ("iPhone", "eBay").
    .map((part) => (/^[a-z]+[A-Z]/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("  ·  ")
    .slice(0, 120);

  return { tagline: TAGLINES[intent], headline, details };
}
