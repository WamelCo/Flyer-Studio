import type { FontKey, FontWeight } from "./canvas/types";

/** One typographic voice: face, weight, case, tracking (em) and leading. */
export interface TypeRole {
  font: FontKey;
  weight: FontWeight;
  uppercase?: boolean;
  italic?: boolean;
  /** Letter-spacing in em. */
  tracking?: number;
  leading: number;
}

export interface Pairing {
  id: PairingId;
  name: string;
  mood: string;
  bestFor: string;
  display: TypeRole;
  /** Emphasised words inside the headline (weight/italic shift; colour is applied by the layout). */
  emphasis: TypeRole;
  heading: TypeRole;
  body: TypeRole;
  label: TypeRole;
  script: TypeRole;
}

export const PAIRING_IDS = [
  "editorial",
  "impact",
  "poster-condensed",
  "elegant",
  "refined-serif",
  "geometric",
  "tech",
  "friendly",
  "romantic",
] as const;

export type PairingId = (typeof PAIRING_IDS)[number];

type Def = Omit<Pairing, "id">;

const DEFS: Record<PairingId, Def> = {
  editorial: {
    name: "Editorial", mood: "Authoritative, polished, magazine-like",
    bestFor: "corporate, consulting, real estate, professional services",
    display: { font: "serif", weight: 400, leading: 1.04 },
    emphasis: { font: "serif", weight: 900, leading: 1.04 },
    heading: { font: "sans", weight: 600, leading: 1.25 },
    body: { font: "sans", weight: 400, leading: 1.5 },
    label: { font: "sans", weight: 600, uppercase: true, tracking: 0.12, leading: 1.2 },
    script: { font: "serif", weight: 400, italic: true, leading: 1.1 },
  },
  impact: {
    name: "Impact", mood: "Loud, urgent, high-energy",
    bestFor: "recruitment, sales, sports, announcements",
    display: { font: "heavy", weight: 400, uppercase: true, leading: 0.94 },
    emphasis: { font: "heavy", weight: 400, uppercase: true, leading: 0.94 },
    heading: { font: "geometric", weight: 800, uppercase: true, tracking: 0.02, leading: 1.15 },
    body: { font: "geometric", weight: 500, leading: 1.45 },
    label: { font: "geometric", weight: 700, uppercase: true, tracking: 0.16, leading: 1.2 },
    script: { font: "script", weight: 700, leading: 1 },
  },
  "poster-condensed": {
    name: "Poster Condensed", mood: "Cinematic, confident, nightlife",
    bestFor: "concerts, events, film nights, festivals",
    display: { font: "display", weight: 400, uppercase: true, tracking: 0.01, leading: 0.9 },
    emphasis: { font: "display", weight: 400, uppercase: true, tracking: 0.01, leading: 0.9 },
    heading: { font: "condensed", weight: 500, uppercase: true, tracking: 0.06, leading: 1.15 },
    body: { font: "sans", weight: 400, leading: 1.5 },
    label: { font: "condensed", weight: 500, uppercase: true, tracking: 0.22, leading: 1.2 },
    script: { font: "script", weight: 700, leading: 1 },
  },
  elegant: {
    name: "Elegant", mood: "Graceful, warm, celebratory",
    bestFor: "holidays, dinners, galas, weddings, hospitality",
    display: { font: "condensed", weight: 300, uppercase: true, tracking: 0.03, leading: 0.96 },
    emphasis: { font: "condensed", weight: 500, uppercase: true, tracking: 0.03, leading: 0.96 },
    heading: { font: "elegant", weight: 600, leading: 1.2 },
    body: { font: "elegant", weight: 500, leading: 1.4 },
    label: { font: "elegant", weight: 600, uppercase: true, tracking: 0.22, leading: 1.2 },
    script: { font: "calligraphy", weight: 400, leading: 1.05 },
  },
  "refined-serif": {
    name: "Refined Serif", mood: "Classic, trustworthy, considered",
    bestFor: "education, law, finance, healthcare practices",
    display: { font: "dserif", weight: 400, leading: 1.05 },
    emphasis: { font: "dserif", weight: 400, leading: 1.05 },
    heading: { font: "sans", weight: 600, leading: 1.25 },
    body: { font: "sans", weight: 400, leading: 1.5 },
    label: { font: "sans", weight: 600, uppercase: true, tracking: 0.14, leading: 1.2 },
    script: { font: "elegant", weight: 500, italic: true, leading: 1.1 },
  },
  geometric: {
    name: "Geometric", mood: "Modern, clean, direct",
    bestFor: "brochures, agencies, retail, fitness, real estate",
    display: { font: "geometric", weight: 800, tracking: -0.02, leading: 1.02 },
    emphasis: { font: "geometric", weight: 900, tracking: -0.02, leading: 1.02 },
    heading: { font: "geometric", weight: 700, leading: 1.2 },
    body: { font: "sans", weight: 400, leading: 1.5 },
    label: { font: "geometric", weight: 600, uppercase: true, tracking: 0.18, leading: 1.2 },
    script: { font: "script", weight: 700, leading: 1 },
  },
  tech: {
    name: "Tech", mood: "Precise, futuristic, smart",
    bestFor: "tech, startups, webinars, product launches",
    display: { font: "grotesk", weight: 700, tracking: -0.025, leading: 1.0 },
    emphasis: { font: "grotesk", weight: 700, tracking: -0.025, leading: 1.0 },
    heading: { font: "grotesk", weight: 600, leading: 1.2 },
    body: { font: "sans", weight: 400, leading: 1.5 },
    label: { font: "grotesk", weight: 500, uppercase: true, tracking: 0.14, leading: 1.2 },
    script: { font: "grotesk", weight: 400, leading: 1.1 },
  },
  friendly: {
    name: "Friendly", mood: "Playful, approachable, warm",
    bestFor: "kids, schools, community, birthdays, cafés",
    display: { font: "geometric", weight: 900, leading: 1.0 },
    emphasis: { font: "geometric", weight: 900, leading: 1.0 },
    heading: { font: "geometric", weight: 700, leading: 1.2 },
    body: { font: "sans", weight: 400, leading: 1.5 },
    label: { font: "geometric", weight: 700, uppercase: true, tracking: 0.12, leading: 1.2 },
    script: { font: "script", weight: 700, leading: 1 },
  },
  romantic: {
    name: "Romantic", mood: "Romantic, personal, luxurious",
    bestFor: "weddings, valentines, beauty, invitations",
    display: { font: "calligraphy", weight: 400, leading: 1.1 },
    emphasis: { font: "calligraphy", weight: 400, leading: 1.1 },
    heading: { font: "elegant", weight: 700, uppercase: true, tracking: 0.18, leading: 1.2 },
    body: { font: "elegant", weight: 500, leading: 1.45 },
    label: { font: "elegant", weight: 600, uppercase: true, tracking: 0.25, leading: 1.2 },
    script: { font: "calligraphy", weight: 400, leading: 1.05 },
  },
};

export const PAIRINGS: Record<PairingId, Pairing> = Object.fromEntries(
  PAIRING_IDS.map((id) => [id, { id, ...DEFS[id] }]),
) as Record<PairingId, Pairing>;

/**
 * Modular type scale (perfect fourth, 1.333) anchored on a body size derived from the
 * page, so a poster and a story share proportions.
 */
export function typeScale(pageWidth: number, pageHeight: number) {
  const body = Math.round(Math.min(pageWidth, pageHeight) * 0.0185);
  const step = (n: number) => Math.round(body * 1.333 ** n);
  return { caption: step(-1), body, lead: step(1), h3: step(2), h2: step(3), h1: step(5), hero: step(7) };
}
