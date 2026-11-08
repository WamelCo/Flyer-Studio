import { describeReference } from "@flyer/core/design/ideogram";
import { referenceStyleFrom, type ReferenceStyle } from "@flyer/core/design/reference";

import { dominantColors, imageSize } from "./images";

/**
 * A reference image's style: colours measured from its pixels, look described by
 * Ideogram. Either half failing still leaves the other; total failure returns null and
 * the flyer is designed without a reference.
 */
export async function analyseReference(bytes: Uint8Array): Promise<ReferenceStyle | null> {
  try {
    const { type } = await imageSize(bytes);
    const [colors, description] = await Promise.all([
      dominantColors(bytes),
      describeReference({ bytes, type }, { signal: AbortSignal.timeout(45_000) }).catch((error: unknown) => {
        console.warn("[reference] describe failed; using colours only", error);
        return null;
      }),
    ]);
    return referenceStyleFrom(description, colors);
  } catch (error) {
    console.warn("[reference] analysis failed", error);
    return null;
  }
}
