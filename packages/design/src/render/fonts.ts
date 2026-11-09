import FAMILIES from "../../assets/fonts/families.json";
import type { FlyerDoc, FontKey, TextNode } from "../canvas/types";
import NAMES from "./font-names.json";

/**
 * Font identities for designer files. Photoshop text layers and Illustrator's SVG import
 * look fonts up by PostScript name (scripts/font-names.mjs); every family is a free Google
 * Font, so the export tells the designer which ones to install.
 */

export function familyName(font: FontKey) {
  return (FAMILIES as Record<string, string>)[font] ?? "Inter";
}

/** The nearest bundled weight (and italic when the family has one), e.g. "Montserrat-SemiBold". */
export function postscriptName(node: Pick<TextNode, "font" | "fontWeight" | "italic">) {
  const table = NAMES as Record<string, Record<string, string>>;
  const faces = table[node.font] ?? table.sans!;
  const keys = Object.keys(faces);
  const italic = node.italic && keys.some((k) => k.endsWith("i"));
  const candidates = keys.filter((k) => k.endsWith("i") === Boolean(italic));
  const best = candidates.sort((a, b) => Math.abs(parseInt(a, 10) - node.fontWeight) - Math.abs(parseInt(b, 10) - node.fontWeight))[0]!;
  return faces[best]!;
}

/** The families a document's text uses, with where to get each. */
export function fontsUsed(doc: FlyerDoc) {
  const families = [...new Set(doc.nodes.flatMap((n) => (n.type === "text" && !n.hidden && n.text.trim() ? [familyName(n.font)] : [])))].sort();
  return families.map((family) => ({ family, url: `https://fonts.google.com/specimen/${family.replace(/ /g, "+")}` }));
}
