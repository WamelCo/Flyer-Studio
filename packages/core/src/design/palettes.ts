import { isHex, mix, normalizeHex, readableOn } from "./color";

/**
 * Curated palettes. Each names its colour-psychology rationale so the art director can
 * choose by meaning, and assigns colours to roles so layouts never guess.
 */
export interface Palette {
  id: PaletteId;
  name: string;
  mood: string;
  psychology: string;
  bestFor: string;
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  primary: string;
  onPrimary: string;
  accent: string;
  onAccent: string;
  accent2: string;
  dark: string;
  onDark: string;
  tint: string;
}

export const PALETTE_IDS = [
  "trust-blue",
  "clinical-red",
  "harvest-gold",
  "noir-mono",
  "fresh-mint",
  "neon-party",
  "luxe-gold",
  "earth-green",
  "tech-violet",
  "hot-sale",
  "playful-pop",
  "serene-lavender",
  "ocean-coral",
  "estate-navy",
  "espresso",
  "power-orange",
  "spring-garden",
  "academic-crimson",
] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

type Def = Omit<Palette, "id">;

const DEFS: Record<PaletteId, Def> = {
  "trust-blue": {
    name: "Trust Blue", mood: "Trustworthy · professional",
    psychology: "Blue signals competence and reliability; a warm peach keeps it human.",
    bestFor: "corporate, consulting, finance, B2B services",
    bg: "#F6F6F4", surface: "#FFFFFF", ink: "#15171C", muted: "#596070", primary: "#3050B0", onPrimary: "#FFFFFF",
    accent: "#F3A68F", onAccent: "#15171C", accent2: "#2FA968", dark: "#15171C", onDark: "#FFFFFF", tint: "#F9DDD3",
  },
  "clinical-red": {
    name: "Clinical Red", mood: "Urgent · caring · decisive",
    psychology: "Red commands attention and urgency; black and white keep it clinical and clear.",
    bestFor: "healthcare recruitment, emergency services, bold announcements",
    bg: "#FFFFFF", surface: "#F3F3F3", ink: "#1A1A1D", muted: "#55565C", primary: "#D6202A", onPrimary: "#FFFFFF",
    accent: "#232326", onAccent: "#FFFFFF", accent2: "#D6202A", dark: "#1A1A1D", onDark: "#FFFFFF", tint: "#FBE3E4",
  },
  "harvest-gold": {
    name: "Harvest Gold", mood: "Warm · inviting · seasonal",
    psychology: "Amber and burgundy evoke harvest, shared meals and togetherness.",
    bestFor: "food, holidays, restaurants, Thanksgiving, autumn events",
    bg: "#2A1C14", surface: "#3A281D", ink: "#FBF4EA", muted: "#E3CDB4", primary: "#D4A056", onPrimary: "#2A1C14",
    accent: "#9A4130", onAccent: "#FBF4EA", accent2: "#7C8F45", dark: "#1E140E", onDark: "#FBF4EA", tint: "#4A3426",
  },
  "noir-mono": {
    name: "Noir Mono", mood: "Sophisticated · editorial · neutral",
    psychology: "Black and white let imagery lead; soft pastel tints add calm and rhythm.",
    bestFor: "brochures, architecture, agencies, galleries, portfolios",
    bg: "#FFFFFF", surface: "#F2F2F2", ink: "#1C1C1C", muted: "#5E5E5E", primary: "#1C1C1C", onPrimary: "#FFFFFF",
    accent: "#E8A6C9", onAccent: "#1C1C1C", accent2: "#9FD3C7", dark: "#1C1C1C", onDark: "#FFFFFF", tint: "#EDE7F6",
  },
  "fresh-mint": {
    name: "Fresh Mint", mood: "Healthy · calm · clean",
    psychology: "Teal and mint read as health, balance and freshness.",
    bestFor: "clinics, wellness, spas, dental, pharmacy",
    bg: "#F1FAF7", surface: "#FFFFFF", ink: "#0E2E28", muted: "#4A6660", primary: "#0F7A68", onPrimary: "#FFFFFF",
    accent: "#F5B062", onAccent: "#0E2E28", accent2: "#7FD1BE", dark: "#0E2E28", onDark: "#FFFFFF", tint: "#CFEDE4",
  },
  "neon-party": {
    name: "Neon Party", mood: "Festive · energetic · nightlife",
    psychology: "Hot pink and electric cyan on deep violet feel like a night out.",
    bestFor: "parties, concerts, clubs, festivals",
    bg: "#170E33", surface: "#24174A", ink: "#FFFFFF", muted: "#C9BFEA", primary: "#FF3D8B", onPrimary: "#170E33",
    accent: "#FFC93C", onAccent: "#170E33", accent2: "#3DD6F5", dark: "#0E0822", onDark: "#FFFFFF", tint: "#3A2470",
  },
  "luxe-gold": {
    name: "Luxe Gold", mood: "Luxurious · exclusive · premium",
    psychology: "Black and gold read as premium, rare and timeless.",
    bestFor: "galas, luxury brands, jewellery, fine dining, VIP events",
    bg: "#0F0F10", surface: "#1A1A1C", ink: "#F6F1E7", muted: "#BDB3A0", primary: "#C9A45C", onPrimary: "#0F0F10",
    accent: "#E9D9B1", onAccent: "#0F0F10", accent2: "#7D6A45", dark: "#0A0A0B", onDark: "#F6F1E7", tint: "#2A2620",
  },
  "earth-green": {
    name: "Earth Green", mood: "Natural · grounded · sustainable",
    psychology: "Forest green and terracotta feel organic, honest and rooted.",
    bestFor: "eco, farmers markets, outdoor, gardening, sustainability",
    bg: "#F4F0E6", surface: "#FFFDF7", ink: "#1F2A1F", muted: "#5A6353", primary: "#2F5D3A", onPrimary: "#FFFFFF",
    accent: "#C2672C", onAccent: "#FFFFFF", accent2: "#A9B77E", dark: "#1F2A1F", onDark: "#F4F0E6", tint: "#DDE3C7",
  },
  "tech-violet": {
    name: "Tech Violet", mood: "Innovative · futuristic · smart",
    psychology: "Violet and aqua on midnight suggest technology and possibility.",
    bestFor: "tech, startups, webinars, hackathons, apps",
    bg: "#0B1020", surface: "#141B33", ink: "#F2F4FF", muted: "#A5ADCF", primary: "#6A47F2", onPrimary: "#FFFFFF",
    accent: "#2DE2C4", onAccent: "#0B1020", accent2: "#FF6FB5", dark: "#070B17", onDark: "#F2F4FF", tint: "#1E2550",
  },
  "hot-sale": {
    name: "Hot Sale", mood: "Urgent · bold · value",
    psychology: "Red-orange triggers urgency, navy grounds it, yellow flags savings.",
    bestFor: "sales, clearance, promotions, Black Friday, grand openings",
    bg: "#FFF5E9", surface: "#FFFFFF", ink: "#12213B", muted: "#4B5873", primary: "#D3281E", onPrimary: "#FFFFFF",
    accent: "#FFB703", onAccent: "#12213B", accent2: "#12213B", dark: "#12213B", onDark: "#FFFFFF", tint: "#FFE1C2",
  },
  "playful-pop": {
    name: "Playful Pop", mood: "Playful · friendly · youthful",
    psychology: "Bright primaries feel fun, safe and approachable.",
    bestFor: "kids, schools, fairs, birthdays, family events",
    bg: "#FFF9E8", surface: "#FFFFFF", ink: "#1E2340", muted: "#545A78", primary: "#F2602B", onPrimary: "#1E2340",
    accent: "#2EC4B6", onAccent: "#1E2340", accent2: "#3A86FF", dark: "#1E2340", onDark: "#FFFFFF", tint: "#FFE3A3",
  },
  "serene-lavender": {
    name: "Serene Lavender", mood: "Gentle · creative · soothing",
    psychology: "Lavender and rose calm the mind and invite creativity.",
    bestFor: "beauty, yoga, therapy, weddings, florists",
    bg: "#F7F3FB", surface: "#FFFFFF", ink: "#2A2140", muted: "#675E80", primary: "#6A4FA3", onPrimary: "#FFFFFF",
    accent: "#E9A3BE", onAccent: "#2A2140", accent2: "#B8A7DD", dark: "#2A2140", onDark: "#FFFFFF", tint: "#E7DDF4",
  },
  "ocean-coral": {
    name: "Ocean Coral", mood: "Optimistic · open · adventurous",
    psychology: "Deep sea blue feels reliable; coral adds sunshine and adventure.",
    bestFor: "travel, tourism, summer, beach and water events",
    bg: "#EEF6FA", surface: "#FFFFFF", ink: "#0C2A3B", muted: "#4A6473", primary: "#0B6E99", onPrimary: "#FFFFFF",
    accent: "#FF7A59", onAccent: "#0C2A3B", accent2: "#FFD166", dark: "#0C2A3B", onDark: "#FFFFFF", tint: "#CDE7F2",
  },
  "estate-navy": {
    name: "Estate Navy", mood: "Established · stable · refined",
    psychology: "Navy and brass project stability, quality and discretion.",
    bestFor: "real estate, law, insurance, wealth management",
    bg: "#F5F4F0", surface: "#FFFFFF", ink: "#172A3A", muted: "#526170", primary: "#1F3A52", onPrimary: "#FFFFFF",
    accent: "#B8925A", onAccent: "#172A3A", accent2: "#8FA9BF", dark: "#172A3A", onDark: "#F5F4F0", tint: "#E4DCCB",
  },
  espresso: {
    name: "Espresso", mood: "Cozy · artisanal · comforting",
    psychology: "Coffee browns and cream feel handcrafted, warm and familiar.",
    bestFor: "cafés, bakeries, craft markets, bookshops",
    bg: "#F3ECE3", surface: "#FFFAF4", ink: "#3B2418", muted: "#6E5444", primary: "#5A3626", onPrimary: "#FFFAF4",
    accent: "#C98B4F", onAccent: "#3B2418", accent2: "#9FB08A", dark: "#2E1C13", onDark: "#F3ECE3", tint: "#E6D5C3",
  },
  "power-orange": {
    name: "Power Orange", mood: "Energetic · motivating · strong",
    psychology: "High-energy orange on charcoal pushes people to act.",
    bestFor: "gyms, sports, races, bootcamps, competitions",
    bg: "#141518", surface: "#1E2024", ink: "#FFFFFF", muted: "#B3B6BD", primary: "#FF5A1F", onPrimary: "#141518",
    accent: "#F5F5F5", onAccent: "#141518", accent2: "#FFD23F", dark: "#0D0E10", onDark: "#FFFFFF", tint: "#2A2C31",
  },
  "spring-garden": {
    name: "Spring Garden", mood: "Fresh · hopeful · welcoming",
    psychology: "Coral, sage and cream feel open-hearted and hopeful.",
    bestFor: "community events, churches, charities, spring fairs",
    bg: "#FFF8F1", surface: "#FFFFFF", ink: "#2B2A28", muted: "#66605B", primary: "#BF4528", onPrimary: "#FFFFFF",
    accent: "#3F8A77", onAccent: "#FFFFFF", accent2: "#F2C14E", dark: "#2B2A28", onDark: "#FFF8F1", tint: "#F8D9C8",
  },
  "academic-crimson": {
    name: "Academic Crimson", mood: "Credible · ambitious · scholarly",
    psychology: "Crimson and navy carry tradition, prestige and achievement.",
    bestFor: "schools, universities, graduations, courses, workshops",
    bg: "#F7F5F2", surface: "#FFFFFF", ink: "#1B2233", muted: "#566073", primary: "#9E1B32", onPrimary: "#FFFFFF",
    accent: "#1B2E5A", onAccent: "#FFFFFF", accent2: "#D9B44A", dark: "#1B2233", onDark: "#FFFFFF", tint: "#EED9DD",
  },
};

export const PALETTES: Record<PaletteId, Palette> = Object.fromEntries(
  PALETTE_IDS.map((id) => [id, { id, ...DEFS[id] }]),
) as Record<PaletteId, Palette>;

/** Re-key a palette around a client's brand colour while keeping its harmony and contrast. */
export function withBrandColor(palette: Palette, brandColor: string | null | undefined, accentColor?: string | null): Palette {
  let next = palette;
  if (isHex(brandColor)) {
    const primary = normalizeHex(brandColor);
    next = { ...next, primary, onPrimary: readableOn(primary, ["#FFFFFF", next.ink, "#111111"]), tint: mix(primary, next.bg, 0.84) };
  }
  // A second requested colour becomes the accent (emphasis, call to action); text on it
  // is picked for contrast like every other role.
  if (isHex(accentColor)) {
    const accent = normalizeHex(accentColor);
    next = { ...next, accent, accent2: accent, onAccent: readableOn(accent, ["#FFFFFF", next.ink, "#111111"]) };
  }
  return next;
}
