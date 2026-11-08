import type { FlyerDoc } from "@flyer/core/canvas/types";
import { startPreciseEdit } from "@flyer/core/design/ideogram";
import { revisionTargets, toImageBoxes } from "@flyer/core/design/revision";

import { editMask, imageSize, type PixelBox } from "./images";

export type EditQuality = "very_low" | "low" | "medium" | "high";

/** Precise-edit quality ($0.008 / $0.03 / $0.06 / $0.22 per edit). */
export function editQuality(): EditQuality {
  const quality = process.env.IDEOGRAM_EDIT_QUALITY;
  return quality === "very_low" || quality === "medium" || quality === "high" ? quality : "low";
}

export interface RevisionStart {
  generationId: string;
  /** The elements the edit is confined to, in image pixels (empty = whole image may change). */
  targets: { label: string; box: PixelBox }[];
}

/**
 * Starts one revision of a rendered flyer. When the instruction names elements of the
 * design ("the price", "the button", 'Look your best'), a mask confines the edit to
 * exactly those boxes; otherwise precise edit's own locality applies (it copies every
 * pixel it doesn't meaningfully change).
 */
export async function startRevision(source: Uint8Array, instruction: string, design: FlyerDoc | null, quality = editQuality()): Promise<RevisionStart> {
  const { width, height, type } = await imageSize(source);
  const matched = design ? revisionTargets(design, instruction) : [];
  const boxes = design ? toImageBoxes(design, matched.map((t) => t.box), width, height) : [];
  const mask = boxes.length ? await editMask(width, height, boxes) : undefined;
  const generationId = await startPreciseEdit({ bytes: source, type }, instruction, {
    quality,
    ...(mask && { mask: { bytes: mask, type: "image/png" } }),
  });
  return { generationId, targets: matched.map((t, i) => ({ label: t.label, box: boxes[i]! })) };
}
