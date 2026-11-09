import type { FlyerDoc, FlyerFormat } from "@flyer/design/canvas/types";
import { ARCHETYPE_IDS, ARCHETYPES, type ArchetypeId } from "@flyer/design/archetypes";
import { CATEGORY_DEFAULTS, type DesignBrief, type rankedChoices } from "./brief";
import { composeDesign, layoutSuits, type Variant } from "@flyer/design/compose";
import { compare, critique, type Fix, type Review } from "./critic";
import { DECOR_LEVELS, type Decor } from "@flyer/design/decor";
import type { DesignCopy } from "@flyer/design/engine";
import { lintDoc } from "@flyer/design/lint";
import { PALETTE_IDS, PALETTES, type PaletteId } from "@flyer/design/palettes";
import type { FoundPhoto } from "@flyer/design/photos";
import { PAIRING_IDS, PAIRINGS, type PairingId } from "@flyer/design/typography";
import { log } from "@flyer/log";

/**
 * Review → refine → keep the better (Phase 1). Each direction is a slot; weak engine
 * designs get the critic's fixes applied, each revision is compared side by side with
 * its original, and kept only when the critic prefers it. Lint errors trigger a layout
 * swap even without a critic. The strongest direction leads.
 */

export interface Slot {
  doc: FlyerDoc;
  /** null for the Ideogram lead (its artwork can't be re-composed). */
  variant: Variant | null;
  photos: FoundPhoto[];
  decor: Decor;
  copy: DesignCopy;
  label: { layout: string; palette: string; type: string };
  review?: Review;
}

export interface RefineContext {
  brief: DesignBrief;
  choices: ReturnType<typeof rankedChoices>;
  format: FlyerFormat;
  colours: { brandColor: string | null; accentColor: string | null };
  richCopy: boolean;
}

const REFINE_BELOW = 8.5;
const REPLACE_LEAD_BELOW = 6;

const labelFor = (variant: Variant) => ({ layout: ARCHETYPES[variant.archetype].name, palette: PALETTES[variant.palette].name, type: PAIRINGS[variant.pairing].name });

function compose(slot: Omit<Slot, "doc" | "label" | "review">, ctx: RefineContext): Slot {
  const variant = slot.variant!;
  const doc = composeDesign({ format: ctx.format, copy: slot.copy, variant, photos: slot.photos, decor: slot.decor, ...ctx.colours });
  return { ...slot, doc, label: labelFor(variant) };
}

/** The next option not already used by another direction. */
function next<T extends string>(ranked: T[], all: readonly T[], used: Set<string>, current: T) {
  return [...ranked, ...all].find((id) => id !== current && !used.has(id)) ?? current;
}

function usable(id: ArchetypeId, photos: FoundPhoto[], richCopy: boolean, copy: DesignCopy) {
  return layoutSuits(id, { hasPhotos: photos.length > 0, richCopy, copy });
}

/** A new version of an engine slot with the fixes applied (null when nothing changes). */
export function applyFixes(slot: Slot, fixes: Fix[], others: Slot[], ctx: RefineContext): Slot | null {
  if (!slot.variant || !fixes.length) return null;
  const used = (pick: (v: Variant) => string) => new Set(others.flatMap((o) => (o.variant ? [pick(o.variant)] : [])));
  const defaults = CATEGORY_DEFAULTS[ctx.brief.category];
  let variant: Variant = { ...slot.variant };
  let { photos, copy, decor } = slot;

  for (const fix of fixes) {
    if (fix === "swap_palette") variant.palette = next<PaletteId>(ctx.choices.palettes, [...defaults.palettes, ...PALETTE_IDS], used((v) => v.palette), variant.palette);
    if (fix === "swap_type") variant.pairing = next<PairingId>(ctx.choices.pairings, [...defaults.pairings, ...PAIRING_IDS], used((v) => v.pairing), variant.pairing);
    if (fix === "trim_copy") copy = { ...copy, body: null, bodyTitle: null, bullets: copy.bullets.slice(0, 2), features: copy.features.slice(0, 2) };
    if (fix === "less_decor" || fix === "more_decor") {
      const level = DECOR_LEVELS.indexOf(decor.level) + (fix === "more_decor" ? 1 : -1);
      decor = level < 0 ? { ...decor, motifs: [] } : { ...decor, level: DECOR_LEVELS[Math.min(level, DECOR_LEVELS.length - 1)]! };
    }
    if (fix === "drop_photos") photos = [];
    if (fix === "swap_layout" || !usable(variant.archetype, photos, ctx.richCopy, copy)) {
      const candidates = [...ctx.choices.layouts, ...ARCHETYPE_IDS].filter((id) => usable(id, photos, ctx.richCopy, copy));
      variant = { ...variant, archetype: next<ArchetypeId>(candidates, [], used((v) => v.archetype), variant.archetype) };
    }
  }
  const same = JSON.stringify([variant, photos.length, copy, decor]) === JSON.stringify([slot.variant, slot.photos.length, slot.copy, slot.decor]);
  return same ? null : compose({ variant, photos, copy, decor }, ctx);
}

const rank = (slots: Slot[]) => [...slots].sort((a, b) => (b.review?.overall ?? 0) - (a.review?.overall ?? 0));

export async function reviewAndRefine(slots: Slot[], ctx: RefineContext): Promise<Slot[]> {
  const started = Date.now();

  // Objective breakage first: a layout with lint errors is swapped, critic or not.
  let current = slots.map((slot, i) => {
    if (!slot.variant || lintDoc(slot.doc).errors === 0) return slot;
    return applyFixes(slot, ["swap_layout"], slots.filter((_, j) => j !== i), ctx) ?? slot;
  });

  const first = await critique(current.map((s) => s.doc), ctx.brief);
  if (!first) return current;
  current = current.map((slot, i) => ({ ...slot, review: first[i]! }));

  const candidates = current.map((slot, i) => {
    const review = slot.review!;
    const others = current.filter((_, j) => j !== i);
    if (!slot.variant) {
      // An Ideogram lead that reviews poorly is replaced by an engine design (no re-spend).
      if (review.overall >= REPLACE_LEAD_BELOW) return null;
      const suits = (id: ArchetypeId) => usable(id, [], ctx.richCopy, slot.copy);
      const archetype = next<ArchetypeId>(ctx.choices.layouts.filter(suits), ARCHETYPE_IDS.filter(suits), new Set(others.flatMap((o) => (o.variant ? [o.variant.archetype] : []))), "swiss-type");
      return compose({ variant: { archetype, palette: ctx.choices.palettes[0]!, pairing: ctx.choices.pairings[0]! }, photos: [], copy: slot.copy, decor: slot.decor }, ctx);
    }
    return review.overall < REFINE_BELOW ? applyFixes(slot, review.fixes, others, ctx) : null;
  });

  if (candidates.every((c) => !c)) {
    log.info("refine.kept_all", { ms: Date.now() - started, scores: current.map((s) => s.review!.overall) });
    return rank(current);
  }

  // Each revision is judged side by side with its original (absolute re-scores drift by
  // more than a revision gains). It is kept only when clearly preferred, and its score
  // moves by the difference seen in that one comparison.
  const revised = current.flatMap((_, i) => (candidates[i] ? [i] : []));
  const verdicts = await compare(revised.map((i) => [current[i]!.doc, candidates[i]!.doc]), ctx.brief);
  const final = current.map((slot, i) => {
    const verdict = verdicts?.[revised.indexOf(i)];
    if (!verdict || verdict.better !== "B" || verdict.b <= verdict.a) return slot;
    const from = slot.review!.overall;
    const overall = Math.min(10, Math.round((from + verdict.b - verdict.a) * 10) / 10);
    return { ...candidates[i]!, review: { ...slot.review!, overall, problems: [], fixes: [], revision: { from, reason: verdict.reason } } };
  });
  log.info("refine.done", {
    ms: Date.now() - started,
    before: current.map((s) => s.review!.overall),
    after: final.map((s) => s.review!.overall),
    changed: final.map((s, i) => s !== current[i]),
  });
  return rank(final);
}
