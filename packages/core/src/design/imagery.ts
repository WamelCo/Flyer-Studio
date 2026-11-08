/**
 * Hero imagery inference: from what a business does, decide what the flyer's hero image
 * shows and how it is treated. A phone-repair flyer needs a phone with an actually
 * cracked screen; a salon flyer needs a smiling client — and often the strongest design
 * move is a background-removed cutout that overlaps the layout's shapes for depth.
 *
 * Rules are ordered: the first match wins. They feed the art direction (photo subjects)
 * and the renderer (render-prompt.ts treats the largest photo frame as the hero).
 */

export type HeroKind = "person" | "item";

/**
 * cutout: background removed, no frame, overlapping the shapes behind it with a soft
 *         shadow — depth and focus (people, products).
 * framed: a photograph inside the layout's frame — scenes and settings.
 */
export type HeroTreatment = "cutout" | "framed";

export interface HeroSubject {
  subject: string;
  kind: HeroKind;
  treatment: HeroTreatment;
}

interface HeroRule extends HeroSubject {
  match: RegExp;
}

const HERO_RULES: HeroRule[] = [
  // Repairs and electronics: show the problem being solved.
  { match: /\b(phone|screen) repairs?|cracked screen|broken screen|smartphone repair/i, subject: "a modern smartphone with a visibly shattered, spider-web cracked glass screen, three-quarter view", kind: "item", treatment: "cutout" },
  { match: /\blaptop repairs?|computer repairs?/i, subject: "an open laptop with a cracked screen", kind: "item", treatment: "cutout" },
  { match: /\bsolar|inverters?|load ?shedding/i, subject: "rooftop solar panels gleaming in bright sunshine on a family home", kind: "item", treatment: "framed" },
  { match: /\bcctv|security cameras?/i, subject: "a white dome security camera", kind: "item", treatment: "cutout" },
  // Building and hardware.
  { match: /\b(cement|hardware|building materials|roofing sheets|bricks)\b/i, subject: "a neat stack of grey cement bags with a builder's trowel", kind: "item", treatment: "cutout" },
  // Farm inputs.
  { match: /\b(chicks|broilers?|poultry)\b/i, subject: "a cluster of fluffy yellow day-old chicks", kind: "item", treatment: "cutout" },
  { match: /\b(fertili[sz]ers?|seed maize|stock ?feed)\b/i, subject: "a sturdy sack of farm fertiliser beside green maize seedlings", kind: "item", treatment: "cutout" },
  // Food.
  { match: /\b(sadza|beef stew|takeaway|kitchen|plate of)\b/i, subject: "a generous plate of sadza with beef stew and green vegetables, top-down view", kind: "item", treatment: "cutout" },
  { match: /\b(pizza|pizzeria)\b/i, subject: "a freshly baked pizza with melted cheese", kind: "item", treatment: "cutout" },
  { match: /\b(cake|bakery|pastries)\b/i, subject: "a beautifully decorated celebration cake", kind: "item", treatment: "cutout" },
  { match: /\b(braai|shisa nyama|grill)\b/i, subject: "sizzling grilled meat on a braai grid", kind: "item", treatment: "framed" },
  // Groceries and retail.
  { match: /\b(groceries|grocery|supermarket|mealie meal|cooking oil|sugar)\b/i, subject: "a full shopping basket of everyday groceries", kind: "item", treatment: "cutout" },
  // Beauty.
  { match: /\b(braids?|knotless|cornrows|wigs?|hair studio|salon)\b/i, subject: "a smiling young woman with long knotless braids, from the shoulders up", kind: "person", treatment: "cutout" },
  { match: /\b(barber(?:shop)?|haircut|fade)\b/i, subject: "a smiling young man with a fresh fade haircut, from the shoulders up", kind: "person", treatment: "cutout" },
  { match: /\b(nails?|manicure)\b/i, subject: "elegantly manicured hands with glossy painted nails", kind: "item", treatment: "framed" },
  // Services led by people.
  { match: /\bdriving (school|lessons)|learner drivers?|licen[cs]e classes/i, subject: "a smiling young learner driver holding car keys, from the waist up", kind: "person", treatment: "cutout" },
  { match: /\b(school|enrol(?:l)?(?:ing|ment)?|academy|ecd|form [1-6]|tuition)\b/i, subject: "a smiling student in school uniform holding books, from the waist up", kind: "person", treatment: "cutout" },
  { match: /\b(clinic|pharmacy|doctor|nurse|medical|dental)\b/i, subject: "a smiling nurse in scrubs with a stethoscope, from the waist up", kind: "person", treatment: "cutout" },
  { match: /\b(hiring|vacanc(?:y|ies)|recruit|careers?|healthcare training)\b/i, subject: "a smiling young professional in work attire, from the waist up", kind: "person", treatment: "cutout" },
  { match: /\b(gym|fitness|workout|personal trainer)\b/i, subject: "a smiling athlete holding a dumbbell, from the waist up", kind: "person", treatment: "cutout" },
  { match: /\b(consult(?:ing|ancy)?|accounting|accountants?|tax|legal|insurance|financial)\b/i, subject: "a confident smiling business professional with arms crossed, from the waist up", kind: "person", treatment: "cutout" },
  // Gatherings: the crowd is the subject, in its setting.
  { match: /\b(crusade|revival|church|gospel|worship)\b/i, subject: "a joyful crowd worshipping together at an outdoor gathering", kind: "person", treatment: "framed" },
];

/** The hero for a flyer, from the owner's words (prompt, headline, category). Null = no strong subject. */
export function inferHero(text: string): HeroSubject | null {
  const rule = HERO_RULES.find((r) => r.match.test(text));
  return rule ? { subject: rule.subject, kind: rule.kind, treatment: rule.treatment } : null;
}
