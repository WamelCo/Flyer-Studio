import { boldStack } from "./bold-stack";
import { editorialSplit } from "./editorial-split";
import { geometricSplit } from "./geometric-split";
import { photoOverlay } from "./photo-overlay";
import { swissType } from "./swiss-type";
import type { Ctx } from "../engine";

export const ARCHETYPE_IDS = ["editorial-split", "bold-stack", "photo-overlay", "geometric-split", "swiss-type"] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

export interface Archetype {
  id: ArchetypeId;
  name: string;
  description: string;
  bestFor: string;
  /** How many photos the layout is designed around (0 = purely graphic). */
  photos: number;
  /** True when the layout looks unfinished without photography (it is swapped out). */
  needsPhotos: boolean;
  /** True when the layout has sections to fill (body, features, bullets): a one-line message would leave it half empty. */
  needsContent: boolean;
  render: (ctx: Ctx) => void;
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  "editorial-split": {
    id: "editorial-split",
    name: "Editorial split",
    description: "Serif headline column beside a circular hero portrait wrapped by a ring arc, floating icon chips, a why-us section with bullets, an icon feature list and a contact block.",
    bestFor: "corporate services, consulting, clinics, coaching, B2B — content-rich, trustworthy",
    photos: 1,
    needsPhotos: true,
    needsContent: true,
    render: editorialSplit,
  },
  "bold-stack": {
    id: "bold-stack",
    name: "Bold stack",
    description: "Tilted stack of heavy condensed type with one oversized coloured word, a fan of three white-bordered photos, accent bars and brackets, and a hard CTA block with a big phone number.",
    bestFor: "recruitment, enrolment, sales drives, sports, announcements — loud and urgent",
    photos: 3,
    needsPhotos: true,
    needsContent: false,
    render: boldStack,
  },
  "photo-overlay": {
    id: "photo-overlay",
    name: "Photo overlay",
    description: "Full-bleed photograph under a dark scrim with a centred stack: brand caps, a script word layered over tall capitals, a divider, script subline, body and web address.",
    bestFor: "holidays, dinners, galas, concerts, hospitality — atmospheric and emotional",
    photos: 1,
    needsPhotos: false,
    needsContent: false,
    render: photoOverlay,
  },
  "geometric-split": {
    id: "geometric-split",
    name: "Geometric split",
    description: "Light and dark fields meeting at a seam of overlapping circles (photo-filled or tinted, with white outlines); section copy on the light side, headline and contact on the dark side.",
    bestFor: "brochures, agencies, architecture, real estate, business solutions — structured and modern",
    photos: 4,
    needsPhotos: false,
    needsContent: true,
    render: geometricSplit,
  },
  "swiss-type": {
    id: "swiss-type",
    name: "Swiss type",
    description: "Purely typographic: giant flush-left headline on a bold colour field, hairline rules, numbered detail rows and a large disc bleeding off the edge (starburst badge for numeric offers).",
    bestFor: "sales, launches, tech, talks, workshops — when there is no photo or the message is the hero",
    photos: 0,
    needsPhotos: false,
    needsContent: false,
    render: swissType,
  },
};
