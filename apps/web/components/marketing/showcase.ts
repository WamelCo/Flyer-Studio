import type { FlyerDoc } from "@flyer/design/canvas/types";
import { ARCHETYPES } from "@flyer/design/archetypes";
import { composeDesign, type Variant } from "@flyer/design/compose";
import type { Decor } from "@flyer/design/decor";
import type { DesignCopy } from "@flyer/design/engine";
import { PALETTES } from "@flyer/design/palettes";

/**
 * Landing-page examples: real layout-engine output (the same code that designs users'
 * flyers), composed on the server. Photo-free directions keep the page self-contained.
 */

export interface ShowcaseItem {
  prompt: string;
  style: string;
  doc: FlyerDoc;
}

const blank: Omit<DesignCopy, "headline"> = {
  brand: null, eyebrow: null, emphasis: null, subhead: null, bodyTitle: null, body: null,
  bullets: [], features: [], details: [], cta: null,
  contact: { phone: null, email: null, website: null, address: null, social: [] },
};

const EXAMPLES: { prompt: string; copy: DesignCopy; variant: Variant; decor: Decor }[] = [
  {
    prompt: "Summer jazz night at the Blue Room, Friday 8pm, tickets $15",
    copy: { ...blank, brand: "The Blue Room", eyebrow: "Live", headline: "Summer Jazz Night", emphasis: "Jazz", subhead: "an evening of soul", details: [{ icon: "calendar", text: "Friday · 8pm" }, { icon: "ticket", text: "Tickets $15" }], cta: "Get tickets" },
    variant: { archetype: "photo-overlay", palette: "luxe-gold", pairing: "elegant" },
    decor: { level: "balanced", motifs: ["bokeh", "sparkles"] },
  },
  {
    prompt: "Half price on every sneaker, this weekend only",
    copy: { ...blank, eyebrow: "This weekend only", headline: "50% Off Sneakers", emphasis: "50%", subhead: "Every pair. Every size.", details: [{ icon: "calendar", text: "Saturday & Sunday" }], cta: "Shop the sale" },
    variant: { archetype: "swiss-type", palette: "hot-sale", pairing: "impact" },
    decor: { level: "bold", motifs: ["stripes", "halftone", "sparkles"] },
  },
  {
    prompt: "Mia's 6th birthday party, Saturday 2pm, bring your dancing shoes",
    copy: { ...blank, eyebrow: "You're invited", headline: "Mia Turns 6", emphasis: "6", subhead: "Bring your dancing shoes", details: [{ icon: "calendar", text: "Saturday · 2pm" }], cta: "Come celebrate" },
    variant: { archetype: "photo-overlay", palette: "neon-party", pairing: "friendly" },
    decor: { level: "bold", motifs: ["confetti", "stars", "sparkles"] },
  },
  {
    prompt: "Open house Sunday 1–4pm: modern 3-bed with a sunlit garden on Maple Street",
    copy: {
      ...blank,
      eyebrow: "Open house",
      headline: "Modern Living on Maple",
      emphasis: "Modern",
      bodyTitle: "Just listed",
      body: "Three bedrooms and a sunlit garden on a quiet street.",
      bullets: ["3 bedrooms", "Sunlit garden", "Maple Street"],
      details: [{ icon: "calendar", text: "Sunday · 1–4pm" }],
      cta: "Book a viewing",
    },
    variant: { archetype: "geometric-split", palette: "estate-navy", pairing: "refined-serif" },
    decor: { level: "minimal", motifs: ["dots", "grid"] },
  },
  {
    prompt: "Sunrise yoga in the park, every Saturday at 7am, all levels welcome",
    copy: { ...blank, eyebrow: "Every Saturday", headline: "Sunrise Yoga", emphasis: "Sunrise", subhead: "All levels welcome", details: [{ icon: "clock", text: "Saturdays · 7am" }, { icon: "map-pin", text: "In the park" }], cta: "Join us" },
    variant: { archetype: "swiss-type", palette: "serene-lavender", pairing: "geometric" },
    decor: { level: "balanced", motifs: ["waves", "blobs"] },
  },
  {
    prompt: "Tech meetup: building with AI, Thursday 6:30pm, free pizza",
    copy: { ...blank, eyebrow: "Meetup", headline: "Building with AI", emphasis: "AI", subhead: "Demos, ideas and free pizza", details: [{ icon: "calendar", text: "Thursday · 6:30pm" }], cta: "Save your seat" },
    variant: { archetype: "swiss-type", palette: "tech-violet", pairing: "tech" },
    decor: { level: "balanced", motifs: ["grid", "plus"] },
  },
  {
    prompt: "Thanksgiving dinner at Harvest Table, family style, from 5pm",
    copy: { ...blank, brand: "Harvest Table", eyebrow: "Happy", headline: "Thanksgiving Dinner", emphasis: "Thanksgiving", subhead: "served family style", details: [{ icon: "clock", text: "From 5pm" }], cta: "Reserve a table" },
    variant: { archetype: "photo-overlay", palette: "harvest-gold", pairing: "elegant" },
    decor: { level: "balanced", motifs: ["leaves", "frame"] },
  },
  {
    prompt: "Grand opening of Juniper Bakery — fresh bread and pastries from 7am",
    copy: {
      ...blank,
      brand: "Juniper Bakery",
      eyebrow: "Grand opening",
      headline: "Fresh From the Oven",
      emphasis: "Fresh",
      bodyTitle: "Baked every morning",
      body: "Fresh bread and pastries, made by hand from 7am.",
      bullets: ["Sourdough", "Pastries", "Coffee"],
      details: [{ icon: "clock", text: "Open from 7am" }],
      cta: "Come say hello",
    },
    variant: { archetype: "geometric-split", palette: "espresso", pairing: "editorial" },
    decor: { level: "balanced", motifs: ["leaves", "dots"] },
  },
];

export function showcase(): ShowcaseItem[] {
  return EXAMPLES.map(({ prompt, copy, variant, decor }) => ({
    prompt,
    style: `${ARCHETYPES[variant.archetype].name} · ${PALETTES[variant.palette].name}`,
    doc: composeDesign({ format: "poster", copy, variant, photos: [], decor }),
  }));
}
