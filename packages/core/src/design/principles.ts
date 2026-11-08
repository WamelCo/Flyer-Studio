/**
 * The graphic-design principles every flyer follows — written down once, used twice:
 *
 *   1. `enforced`: how the layout engine guarantees the principle in code (measured type,
 *      grid margins, stack() spacing, WCAG checks). These hold for every design, whoever
 *      renders it.
 *   2. `directive`: the instruction the render prompt carries to the image model
 *      (render-prompt.ts), so a rendered flyer keeps the structure the engine designed
 *      instead of drifting into painterly, abstract "AI art".
 *
 * The model is a renderer, not the designer. The engine decides where everything goes;
 * these directives tell the renderer how a professional would finish it.
 */

export interface Principle {
  id: PrincipleId;
  name: string;
  /** The rule as a designer states it. */
  rule: string;
  /** How the engine guarantees it (file / function). */
  enforced: string;
  /** The full instruction for the image model (documentation, and for long-form prompts). */
  directive: string;
  /**
   * A few words for the structured prompt's style block. Long style prose gets rendered
   * as text by image models when a layout has empty space — cues stay short on purpose.
   */
  cue: string;
}

export const PRINCIPLE_IDS = [
  "hierarchy",
  "grid",
  "spacing",
  "alignment",
  "proximity",
  "contrast",
  "color",
  "typography",
  "balance",
  "whitespace",
  "focal-point",
  "shape-language",
  "consistency",
  "imagery",
  "legibility",
] as const;

export type PrincipleId = (typeof PRINCIPLE_IDS)[number];

const DEFS: Record<PrincipleId, Omit<Principle, "id">> = {
  hierarchy: {
    name: "Visual hierarchy",
    rule: "One dominant headline, a clear second level, then supporting detail. A reader should know what to read first, second and last within three seconds.",
    enforced: "Modular type scale (typography.ts typeScale, perfect fourth): hero / h1 / h2 / h3 / body / caption steps; the headline is fitted to its column (engine.ts fitHeadline).",
    directive: "Strict typographic hierarchy: the headline is unmistakably dominant, secondary lines step down clearly in size and weight, and body copy is small and quiet.",
    cue: "strict typographic hierarchy, one dominant headline",
  },
  grid: {
    name: "Grid & structure",
    rule: "Everything sits on an underlying grid: columns, gutters and margins. Elements are placed, not scattered.",
    enforced: "Every archetype builds on the page margin ctx.m (7.5% of the short side) and column splits; positions are computed, never random.",
    directive: "Built on a precise layout grid with consistent outer margins; every text block and shape snaps to the same columns and edges.",
    cue: "precise layout grid, consistent margins, every element exactly inside its box",
  },
  spacing: {
    name: "Spacing rhythm",
    rule: "Spacing comes from one base unit and its multiples. Equal relationships get equal gaps; gaps grow with the importance of the break.",
    enforced: "ctx.u (1% of the short side, an 8-point-style unit) drives every gap; stack() spaces blocks by multiples of it and drops low-priority copy rather than crowding.",
    directive: "Consistent spacing rhythm from a single base unit: identical gaps between related items, larger gaps between sections, nothing cramped and nothing floating.",
    cue: "consistent spacing rhythm",
  },
  alignment: {
    name: "Alignment",
    rule: "Text shares edges: flush-left columns align to one line, centred stacks share one axis. Nothing is placed by eye alone.",
    enforced: "Text nodes in a stack share x and width; centred archetypes centre every line on the page axis.",
    directive: "Crisp alignment: text blocks share exact left edges or one centre axis; shapes line up with the text they belong to.",
    cue: "crisp shared alignment edges",
  },
  proximity: {
    name: "Proximity & grouping",
    rule: "Related information sits together (icon with its label, date with time, contact lines as one block); unrelated groups are separated.",
    enforced: "iconRows, contact blocks and feature rows group items with tight internal gaps and wider outer gaps.",
    directive: "Related information is grouped tightly into clear blocks (icon beside its label, contact details together), with clear separation between groups.",
    cue: "related details grouped tightly",
  },
  contrast: {
    name: "Contrast",
    rule: "Contrast of size, weight and colour creates emphasis — and text must stay readable against whatever is behind it.",
    enforced: "WCAG 4.5:1 body / 3:1 display via inkOn / mutedOn / softOn / readableOn; pnpm audit:contrast checks every layout × palette × pairing × format.",
    directive: "High contrast between text and its background everywhere; emphasis comes from a deliberate shift in size, weight or the accent colour.",
    cue: "high text contrast",
  },
  color: {
    name: "Colour psychology & proportion",
    rule: "A small curated palette chosen for its meaning, used in roughly 60/30/10 proportion: dominant neutral, supporting colour, one accent for emphasis and the call to action.",
    enforced: "Curated palettes (palettes.ts) each state their psychology and assign colours to roles (bg, ink, primary, accent, dark) so layouts never guess.",
    directive: "Limited palette used with discipline (about 60% dominant, 30% secondary, 10% accent); the accent colour is reserved for emphasis and the call to action.",
    cue: "disciplined 60-30-10 palette, accent only for emphasis",
  },
  typography: {
    name: "Typography",
    rule: "At most two type families, paired for contrast (display + text). Consistent weights, generous leading for body, tight leading for display, tracking on small caps.",
    enforced: "Pairings (typography.ts) define display / emphasis / heading / body / label / script roles; text is measured with real font metrics (metrics.ts) so nothing overflows.",
    directive: "Professional typography: no more than two typefaces, clean kerning, tight leading on display type, comfortable leading on body text, letter-spaced small caps for labels.",
    cue: "professional kerning and leading, two typefaces maximum",
  },
  balance: {
    name: "Balance",
    rule: "Visual weight is distributed on purpose — symmetrical for calm and formal, asymmetrical for energy — never accidentally lopsided.",
    enforced: "Archetypes are designed as symmetric (photo-overlay) or deliberately asymmetric (editorial-split, bold-stack) compositions.",
    directive: "Deliberate visual balance; heavy elements are counterweighted so the page feels composed, not lopsided.",
    cue: "deliberately balanced composition",
  },
  whitespace: {
    name: "Whitespace",
    rule: "Empty space is a design element. Generous margins and breathing room make a flyer look premium; clutter makes it look cheap.",
    enforced: "Generous outer margins, stack() drops low-priority copy instead of shrinking it, and decor only goes into measured free space (decor.ts decorate).",
    directive: "Generous whitespace and clean margins; the layout breathes and is never cluttered.",
    cue: "generous whitespace, uncluttered",
  },
  "focal-point": {
    name: "Focal point & reading flow",
    rule: "One entry point (headline or hero image), then a guided path — typically Z- or F-pattern — ending at the call to action.",
    enforced: "Archetypes order content top-to-bottom / left-to-right and anchor the CTA and contact block at the end of the reading path.",
    directive: "A single clear focal point, then an obvious reading path that ends at the call to action.",
    cue: "single focal point, clear reading path to the call to action",
  },
  "shape-language": {
    name: "Discernible shape language",
    rule: "Shapes are intentional geometric forms — bars, circles, rings, brackets, frames — with crisp edges, sized and placed to support the text. No meaningless blobs or texture noise.",
    enforced: "Shapes are rect / ellipse / arc / path nodes with exact geometry; motifs come from a fixed catalogue (decor.ts) and never sit behind type.",
    directive: "Crisp, flat, clearly defined geometric shapes (solid bars, circles, rings, brackets, frames) with sharp vector edges; no abstract swirls, smoke, splatter, random textures or melting forms.",
    cue: "flat crisp geometric shapes with sharp vector edges, no abstract swirls or textures",
  },
  consistency: {
    name: "Consistency & repetition",
    rule: "Repeated elements look identical: same corner radius, stroke weight, icon style, bullet style and spacing everywhere.",
    enforced: "Every repeated element (icon chips, feature rows, bullets, photo borders) comes from one helper with fixed parameters.",
    directive: "Rigorous consistency: repeated elements share identical size, stroke weight, corner radius and icon style.",
    cue: "consistent icon style, stroke weight and corner radius",
  },
  imagery: {
    name: "Imagery treatment",
    rule: "Photos live in deliberate frames — rectangles, circles, white borders — cropped to their subject, never floating cut-outs or painterly scenes.",
    enforced: "Photo frames are image nodes with exact boxes, corner radii and strokes (engine.ts photo).",
    directive: "Photographs sit inside clean, deliberate frames (sharp rectangles, circles or white-bordered prints), cropped to the subject.",
    cue: "photos inside clean deliberate frames",
  },
  legibility: {
    name: "Legibility & accuracy",
    rule: "Every word is spelled exactly as written and readable at a glance; no filler text, no invented details.",
    enforced: "Copy comes only from the brief; guardFacts (facts.ts) strips invented dates, prices and contacts before layout.",
    directive: "Render every piece of text exactly as written, sharp and legible; add no other words, numbers, logos or placeholder text.",
    cue: "sharp legible text exactly as written",
  },
};

export const PRINCIPLES: Record<PrincipleId, Principle> = Object.fromEntries(
  PRINCIPLE_IDS.map((id) => [id, { id, ...DEFS[id] }]),
) as Record<PrincipleId, Principle>;

/** Every directive, in priority order — the renderer's design brief. */
export function principleDirectives(ids: readonly PrincipleId[] = PRINCIPLE_IDS) {
  return ids.map((id) => PRINCIPLES[id].directive);
}

/** Every cue, in priority order — compact form for the structured prompt. */
export function principleCues(ids: readonly PrincipleId[] = PRINCIPLE_IDS) {
  return ids.map((id) => PRINCIPLES[id].cue);
}
