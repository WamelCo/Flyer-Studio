import type { FlyerDoc } from "@flyer/design/canvas/types";
import { decorForVariant } from "@flyer/ai/brief";
import { composeDesign, type Variant } from "@flyer/design/compose";
import type { Decor } from "@flyer/design/decor";
import type { DesignCopy } from "@flyer/design/engine";

/**
 * Landing-page demo content: real layout-engine output for three prompts, composed on
 * the server at build time. Photo-free directions keep the hero self-contained.
 */

export interface DemoScene {
  prompt: string;
  docs: FlyerDoc[];
  directions: string[];
}

const blank: Omit<DesignCopy, "headline"> = {
  brand: null, eyebrow: null, emphasis: null, subhead: null, bodyTitle: null, body: null,
  bullets: [], features: [], details: [], cta: null,
  contact: { phone: null, email: null, website: null, address: null, social: [] },
};

const SCENES: { prompt: string; copy: DesignCopy; variants: Variant[]; decor: Decor }[] = [
  {
    prompt: "Summer jazz night at the Blue Room, Friday 8pm, tickets $15",
    copy: {
      ...blank,
      brand: "The Blue Room",
      eyebrow: "Live",
      headline: "Summer Jazz Night",
      emphasis: "Jazz",
      subhead: "an evening of soul",
      details: [
        { icon: "calendar", text: "Friday · 8pm" },
        { icon: "ticket", text: "Tickets $15" },
      ],
      cta: "Get tickets",
    },
    decor: { level: "balanced", motifs: ["bokeh", "sparkles", "rings"] },
    variants: [
      { archetype: "photo-overlay", palette: "luxe-gold", pairing: "elegant" },
      { archetype: "swiss-type", palette: "neon-party", pairing: "poster-condensed" },
      { archetype: "geometric-split", palette: "tech-violet", pairing: "geometric" },
    ],
  },
  {
    prompt: "50% off everything this weekend at Juniper & Co.",
    copy: {
      ...blank,
      brand: "Juniper & Co.",
      eyebrow: "This weekend only",
      headline: "50% Off Everything",
      emphasis: "50%",
      subhead: "Our biggest sale of the year.",
      details: [
        { icon: "calendar", text: "Saturday & Sunday" },
        { icon: "tag", text: "No code needed" },
      ],
      cta: "Shop now",
    },
    decor: { level: "bold", motifs: ["stripes", "halftone", "sparkles"] },
    variants: [
      { archetype: "swiss-type", palette: "hot-sale", pairing: "impact" },
      { archetype: "swiss-type", palette: "power-orange", pairing: "poster-condensed" },
      { archetype: "geometric-split", palette: "playful-pop", pairing: "friendly" },
    ],
  },
  {
    prompt: "Open house Sunday 1–4pm, 3 bed modern home on Maple Street",
    copy: {
      ...blank,
      eyebrow: "Open house",
      headline: "Modern Living on Maple",
      emphasis: "Modern",
      bodyTitle: "Just listed",
      body: "Three bedrooms, two baths and a sunlit garden, minutes from the park.",
      bullets: ["3 bedrooms", "2 bathrooms", "Garden"],
      details: [{ icon: "calendar", text: "Sunday · 1–4pm" }],
      cta: "Book a viewing",
    },
    decor: { level: "minimal", motifs: ["grid", "rings", "dots"] },
    variants: [
      { archetype: "geometric-split", palette: "estate-navy", pairing: "refined-serif" },
      { archetype: "swiss-type", palette: "earth-green", pairing: "editorial" },
      { archetype: "photo-overlay", palette: "espresso", pairing: "refined-serif" },
    ],
  },
];

export function demoScenes(): DemoScene[] {
  return SCENES.map(({ prompt, copy, variants, decor }) => ({
    prompt,
    docs: variants.map((variant, i) => composeDesign({ format: "poster", copy, variant, photos: [], decor: decorForVariant(decor, i) })),
    directions: variants.map((v) => v.palette),
  }));
}
