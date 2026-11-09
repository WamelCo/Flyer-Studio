import { boldStack } from "./bold-stack";
import { editorialSplit } from "./editorial-split";
import { geometricSplit } from "./geometric-split";
import { photoOverlay } from "./photo-overlay";
import { swissType } from "./swiss-type";
import { agenda, agendaSteps } from "./agenda";
import { bigNumber } from "./big-number";
import { collage } from "./collage";
import { focusWindow } from "./focus-window";
import { outlinePortrait } from "./outline-portrait";
import { productArc } from "./product-arc";
import { triptych } from "./triptych";
import { magazineCover } from "./magazine-cover";
import { menuBoard, menuItems } from "./menu-board";
import { productHero } from "./product-hero";
import { diagonalSplit } from "./diagonal-split";
import { invitation } from "./invitation";
import { minimalCentre } from "./minimal-centre";
import { ticket } from "./ticket";
import { headlineFigure } from "./shared";
import type { DecorLevel } from "../decor";
import type { Ctx, DesignCopy } from "../engine";

export const ARCHETYPE_IDS = [
  "editorial-split",
  "bold-stack",
  "photo-overlay",
  "geometric-split",
  "swiss-type",
  "minimal-centre",
  "diagonal-split",
  "ticket",
  "big-number",
  "invitation",
  "magazine-cover",
  "menu-board",
  "agenda",
  "product-hero",
  "collage",
  "focus-window",
  "triptych",
  "outline-portrait",
  "product-arc",
] as const;
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
  /** Whether the copy suits the layout at all (a big-number layout needs a figure). Absent = always. */
  fits?: (copy: DesignCopy) => boolean;
  /** The most decoration the layout tolerates; "none" for layouts that carry their own detailing. */
  maxDecor?: DecorLevel | "none";
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
  "minimal-centre": {
    id: "minimal-centre",
    name: "Minimal centre",
    description: "One quiet centred column on an open field inside a hairline mat: small caps label, refined headline, short accent rule, subhead and details — hierarchy from size and space alone.",
    bestFor: "luxury, gallery and store openings, announcements, premium services, minimal brands — calm and confident",
    photos: 0,
    needsPhotos: false,
    needsContent: false,
    maxDecor: "minimal",
    render: minimalCentre,
  },
  "diagonal-split": {
    id: "diagonal-split",
    name: "Diagonal split",
    description: "The page cut by one bold diagonal: headline on the open side, details and CTA on a saturated colour field, an accent stripe riding the cut.",
    bestFor: "sports, launches, sales, recruitment, tech and youth events — dynamic and modern",
    photos: 0,
    needsPhotos: false,
    needsContent: false,
    render: diagonalSplit,
  },
  ticket: {
    id: "ticket",
    name: "Ticket",
    description: "The flyer as an admission ticket: rounded card with a perforated tear line and notches, headline and detail rows on the card, a coloured stub with the call to action and a barcode.",
    bestFor: "concerts, parties, festivals, screenings, raffles, coupons and giveaways",
    photos: 0,
    needsPhotos: false,
    needsContent: false,
    render: ticket,
  },
  "big-number": {
    id: "big-number",
    name: "Big number",
    description: "One figure from the copy (50%, an age, a year, a date) set at poster scale as the graphic, with the message tight beneath; the headline's initial as a monogram when there is no figure.",
    bestFor: "sales and discounts, birthdays and anniversaries, countdowns, statistics, launches",
    photos: 0,
    needsPhotos: false,
    needsContent: false,
    fits: (copy) => headlineFigure(copy) !== null,
    render: bigNumber,
  },
  invitation: {
    id: "invitation",
    name: "Invitation",
    description: "Formal stationery: a double-rule frame with diamond corners, a script line, the headline, an ornamental divider and each detail centred on its own line, RSVP at the foot.",
    bestFor: "weddings, galas, baby and bridal showers, birthdays, ceremonies, dinners, memorials",
    photos: 0,
    needsPhotos: false,
    needsContent: false,
    maxDecor: "minimal",
    render: invitation,
  },
  "magazine-cover": {
    id: "magazine-cover",
    name: "Magazine cover",
    description: "A full-bleed photograph with the masthead (brand or eyebrow) set edge to edge across the top, an issue line, and cover lines plus the headline stacked at the foot over a scrim.",
    bestFor: "fashion, beauty, music, artist and speaker profiles, launches, lifestyle brands",
    photos: 1,
    needsPhotos: true,
    needsContent: false,
    render: magazineCover,
  },
  "menu-board": {
    id: "menu-board",
    name: "Menu / price list",
    description: "A framed board: header, then items with dotted leaders running to their prices (as written), an optional note under each, details and CTA at the foot; two columns for long lists.",
    bestFor: "restaurants, cafés, bakeries, salons and barbers, price lists, service menus, packages",
    photos: 0,
    needsPhotos: false,
    needsContent: true,
    fits: (copy) => menuItems(copy).length >= 3,
    render: menuBoard,
  },
  agenda: {
    id: "agenda",
    name: "Agenda",
    description: "A programme as a vertical timeline: a rail with a node per step, times in the accent, each step titled with a short note; header on a dark field.",
    bestFor: "conferences, workshops, church programmes, weddings (order of the day), itineraries, course schedules",
    photos: 0,
    needsPhotos: false,
    needsContent: true,
    fits: (copy) => agendaSteps(copy).length >= 3,
    render: agenda,
  },
  "product-hero": {
    id: "product-hero",
    name: "Product hero",
    description: "The product or dish as a big rounded photograph on a soft tinted field with a colour disc behind it, a price badge when the copy states one, feature chips and the CTA below.",
    bestFor: "product launches, shop and menu items, gadgets, cosmetics, food specials, e-commerce promos",
    photos: 1,
    needsPhotos: true,
    needsContent: false,
    render: productHero,
  },
  collage: {
    id: "collage",
    name: "Collage",
    description: "An asymmetric mosaic of up to four photographs (one large, the rest stacked beside it) over a clean copy panel; missing photos become colour tiles.",
    bestFor: "travel, community and church events, school open days, event recaps, real-estate showcases, tours",
    photos: 4,
    needsPhotos: true,
    needsContent: false,
    render: collage,
  },
  "focus-window": {
    id: "focus-window",
    name: "Focus window",
    description: "Designer photo-manipulation: the portrait blurred, black-and-white and grainy across the page, a sharp full-colour strip of the same photo in a hairline frame, the headline crossing into the strip, rotated microtype, crosshair marks.",
    bestFor: "portraits, artists, photographers, birthdays, personal brands, launches, events with a face — premium and editorial",
    photos: 1,
    needsPhotos: true,
    needsContent: false,
    maxDecor: "none",
    render: focusWindow,
  },
  triptych: {
    id: "triptych",
    name: "Triptych",
    description: "Three tall photo panels in a duotone of the palette, the centre one full colour and standing forward; big title above, the date running down both margins, a date block and venue block at the foot.",
    bestFor: "concerts, club nights, tours, festivals, sports events, launches with a headline act",
    photos: 3,
    needsPhotos: true,
    needsContent: false,
    maxDecor: "none",
    render: triptych,
  },
  "outline-portrait": {
    id: "outline-portrait",
    name: "Outline portrait",
    description: "A black-and-white portrait on textured paper, a giant outlined word running up the left across it, one colour block laid over the photo and a leader line to a tag with the message.",
    bestFor: "fashion, barbers and salons, fitness, recruitment, motivation, personal brands — editorial and bold",
    photos: 1,
    needsPhotos: true,
    needsContent: false,
    maxDecor: "none",
    render: outlinePortrait,
  },
  "product-arc": {
    id: "product-arc",
    name: "Product arc",
    description: "The product in a circle inside a wide gradient ring, its benefits on icon chips following the ring's curve, a confident headline above and the CTA at the foot, on paper texture.",
    bestFor: "cosmetics, hair and skin care, food and drink products, wellness, gadgets, e-commerce",
    photos: 1,
    needsPhotos: true,
    needsContent: false,
    maxDecor: "none",
    render: productArc,
  },
};
