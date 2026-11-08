/** Colour maths for the design engine: parsing, mixing and WCAG contrast. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? [...clean].map((c) => c + c).join("") : clean.slice(0, 6);
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]: RGB) {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function isHex(value: string | null | undefined): value is string {
  return Boolean(value && /^#?[0-9a-f]{6}$/i.test(value.trim()));
}

export function normalizeHex(value: string) {
  const trimmed = value.trim();
  return (trimmed.startsWith("#") ? trimmed : `#${trimmed}`).toUpperCase();
}

/** Linear blend: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

export function alpha(hex: string, opacity: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, opacity))})`;
}

function channel(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio, 1–21. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Thresholds: body text 4.5, large display text 3. */
export const CONTRAST = { body: 4.5, large: 3 } as const;

/** The first candidate that clears `minimum` against `background`, else the best available. */
export function readableOn(background: string, candidates: string[], minimum: number = CONTRAST.body) {
  const ranked = candidates.map((color) => ({ color, ratio: contrast(color, background) }));
  return ranked.find((entry) => entry.ratio >= minimum)?.color ?? ranked.sort((a, b) => b.ratio - a.ratio)[0]!.color;
}

export function isDark(hex: string) {
  return luminance(hex) < 0.22;
}
