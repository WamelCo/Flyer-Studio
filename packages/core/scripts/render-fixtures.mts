/** Hand-written flyers mirroring the reference designs (fictional brands), shared by the render scripts. */
import type { FlyerFormat } from "../src/canvas/types";
import type { Variant } from "../src/design/compose";
import type { Decor } from "../src/design/decor";
import type { DesignCopy } from "../src/design/engine";

const blank: DesignCopy = {
  brand: null, eyebrow: null, headline: "", emphasis: null, subhead: null, bodyTitle: null, body: null,
  bullets: [], features: [], details: [], cta: null,
  contact: { phone: null, email: null, website: null, address: null, social: [] },
};

export interface Fixture {
  subject: string;
  tone: string[];
  format: FlyerFormat;
  variant: Variant;
  decor: Decor;
  copy: DesignCopy;
  photos: string[];
}

export const FIXTURES: Record<string, Fixture> = {
  health: {
    subject: "a healthcare training institute recruiting students",
    tone: ["urgent", "caring", "confident"],
    format: "square",
    variant: { archetype: "bold-stack", palette: "clinical-red", pairing: "impact" },
    decor: { level: "balanced", motifs: ["plus", "dots"] },
    copy: {
      ...blank,
      brand: "Harbor Health Training",
      eyebrow: "Find your",
      headline: "Dream job in healthcare",
      emphasis: "Dream",
      cta: "Contact us",
      contact: { phone: "555-014-2290", email: null, website: "harborhealthtraining.com", address: null, social: ["@harborhealth"] },
    },
    photos: [
      "a smiling nurse in teal scrubs and a stethoscope, hospital corridor softly blurred behind",
      "a cheerful group of diverse nursing graduates in navy scrubs holding certificates",
      "two medical professionals in scrubs and a white coat reviewing a yellow clipboard",
    ],
  },
  consulting: {
    subject: "a business consulting firm",
    tone: ["trustworthy", "professional", "modern"],
    format: "poster",
    variant: { archetype: "editorial-split", palette: "trust-blue", pairing: "editorial" },
    decor: { level: "balanced", motifs: ["dots", "plus"] },
    copy: {
      ...blank,
      brand: "Northwind",
      headline: "Boost productivity and profit",
      emphasis: "profit",
      subhead: "With our expertise",
      bodyTitle: "Why should you pick us?",
      body: "We don't just advise — we implement strategies and measure success, so you see a tangible return.",
      bullets: ["Executive coaching", "Risk management", "Innovative solutions"],
      features: [
        { title: "Strategic planning", text: "Long-term strategies built for growth and profitability.", icon: "target" },
        { title: "Market research", text: "Trends, customers and competition, analysed clearly.", icon: "search" },
        { title: "Financial analysis", text: "Budgets reviewed to reduce cost and lift revenue.", icon: "bar-chart" },
      ],
      cta: "Call us now",
      contact: { phone: "555-123-4567", email: "hello@northwind.co", website: "northwind.co", address: null, social: [] },
    },
    photos: ["a confident bearded businessman in a crisp white shirt with arms crossed, plain light studio background"],
  },
  thanksgiving: {
    subject: "a restaurant's Thanksgiving special offer",
    tone: ["warm", "inviting", "elegant"],
    format: "poster",
    variant: { archetype: "photo-overlay", palette: "harvest-gold", pairing: "elegant" },
    decor: { level: "minimal", motifs: ["leaves", "frame"] },
    copy: {
      ...blank,
      brand: "The Copper Table",
      eyebrow: "Happy",
      headline: "Thanksgiving",
      subhead: "Special offer",
      body: "Three courses, shared with the people you love.",
      contact: { phone: null, email: null, website: "coppertable.com", address: null, social: [] },
    },
    photos: ["friends toasting with glasses of wine over a warm Thanksgiving dinner table with roasted dishes, candlelight"],
  },
  brochure: {
    subject: "a business solutions company brochure",
    tone: ["structured", "modern", "calm"],
    format: "poster",
    variant: { archetype: "geometric-split", palette: "noir-mono", pairing: "geometric" },
    decor: { level: "minimal", motifs: ["grid", "dots"] },
    copy: {
      ...blank,
      brand: "Crestline",
      headline: "Solutions for your business",
      bodyTitle: "Our mission",
      body: "We help growing companies plan, build and scale with clear strategy and steady execution.",
      cta: "Get in touch",
      contact: { phone: "555-201-8890", email: "team@crestline.co", website: "crestline.co", address: "1234 Main Street, Springfield", social: [] },
    },
    photos: [
      "a modern city skyline with glass towers on a clear day",
      "a calm river reflecting city buildings",
      "a green park beside an urban waterfront",
      "a tall modern skyscraper seen from below",
    ],
  },
  tech: {
    subject: "a software product launch webinar",
    tone: ["precise", "bold", "forward-looking"],
    format: "story",
    variant: { archetype: "swiss-type", palette: "tech-violet", pairing: "tech" },
    decor: { level: "balanced", motifs: ["rings", "grid"] },
    copy: {
      ...blank,
      brand: "Lumen",
      eyebrow: "Live webinar",
      headline: "Ship faster with Lumen 3",
      emphasis: "faster",
      subhead: "See what's new in our biggest release yet",
      details: [
        { icon: "calendar", text: "Thursday, March 12" },
        { icon: "clock", text: "11am PT" },
        { icon: "globe", text: "Online · free" },
      ],
      cta: "Save your seat",
      contact: { phone: null, email: null, website: "lumen.dev/live", address: null, social: [] },
    },
    photos: [],
  },
};
