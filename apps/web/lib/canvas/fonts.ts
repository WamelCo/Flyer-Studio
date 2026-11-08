import {
  Anton,
  Bebas_Neue,
  Caveat,
  Cormorant_Garamond,
  DM_Serif_Display,
  Great_Vibes,
  Inter,
  Montserrat,
  Oswald,
  Playfair_Display,
  Space_Grotesk,
} from "next/font/google";

import type { FlyerDoc, FontKey } from "@flyer/core/canvas/types";

// Flyer typefaces (the app UI itself uses the SF system stack). Self-hosted by next/font,
// so canvas rendering and exports never depend on the user's installed fonts.
// Keep in sync with scripts/gen-font-metrics.mjs.
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false });
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"] });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], display: "swap", preload: false });
const dmSerif = DM_Serif_Display({ subsets: ["latin"], weight: "400", display: "swap", preload: false });
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", display: "swap", preload: false });
const anton = Anton({ subsets: ["latin"], weight: "400", display: "swap", preload: false });
const oswald = Oswald({ subsets: ["latin"], display: "swap", preload: false });
const grotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", preload: false });
const greatVibes = Great_Vibes({ subsets: ["latin"], weight: "400", display: "swap", preload: false });
const caveat = Caveat({ subsets: ["latin"], display: "swap", preload: false });

export const FONT_FAMILIES: Record<FontKey, string> = {
  sans: inter.style.fontFamily,
  geometric: montserrat.style.fontFamily,
  serif: playfair.style.fontFamily,
  elegant: cormorant.style.fontFamily,
  dserif: dmSerif.style.fontFamily,
  display: bebas.style.fontFamily,
  heavy: anton.style.fontFamily,
  condensed: oswald.style.fontFamily,
  grotesk: grotesk.style.fontFamily,
  calligraphy: greatVibes.style.fontFamily,
  script: caveat.style.fontFamily,
};

export const FONT_LABELS: Record<FontKey, string> = {
  sans: "Inter",
  geometric: "Montserrat",
  serif: "Playfair",
  elegant: "Cormorant",
  dserif: "DM Serif",
  display: "Bebas Neue",
  heavy: "Anton",
  condensed: "Oswald",
  grotesk: "Space Grotesk",
  calligraphy: "Great Vibes",
  script: "Caveat",
};

export const FONT_KEYS = Object.keys(FONT_FAMILIES) as FontKey[];

/** Canvas text only renders correctly once the face is loaded; @font-face alone is lazy. */
export async function loadFonts(doc?: FlyerDoc) {
  if (typeof document === "undefined") return;
  const faces = doc
    ? [...new Set(doc.nodes.flatMap((node) => (node.type === "text" ? [`${node.italic ? "italic " : ""}${node.fontWeight}|${node.font}`] : [])))]
    : FONT_KEYS.flatMap((key) => [`400|${key}`, `700|${key}`]);
  await Promise.all(
    faces.map((face) => {
      const [weight, key] = face.split("|") as [string, FontKey];
      return document.fonts.load(`${weight} 32px ${FONT_FAMILIES[key]}`);
    }),
  ).catch(() => undefined);
}
