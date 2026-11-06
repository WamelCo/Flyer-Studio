import type { FlyerFormat } from "@/lib/canvas/types";

export interface FormatSpec {
  id: FlyerFormat;
  label: string;
  detail: string;
  /** Logical page size in canvas units. */
  width: number;
  height: number;
  /** SDXL-friendly generation size (multiples of 64, ~1 megapixel). */
  generation: { width: number; height: number };
  /** Physical PDF page size in points, when the format is a print size. */
  pdfPoints?: { width: number; height: number };
}

export const FORMATS: Record<FlyerFormat, FormatSpec> = {
  poster: {
    id: "poster",
    label: "Poster",
    detail: "A4 · print",
    width: 1240,
    height: 1754,
    generation: { width: 832, height: 1216 },
    pdfPoints: { width: 595.28, height: 841.89 },
  },
  square: {
    id: "square",
    label: "Square",
    detail: "1:1 · social",
    width: 1080,
    height: 1080,
    generation: { width: 1024, height: 1024 },
  },
  story: {
    id: "story",
    label: "Story",
    detail: "9:16 · vertical",
    width: 1080,
    height: 1920,
    generation: { width: 768, height: 1344 },
  },
  landscape: {
    id: "landscape",
    label: "Landscape",
    detail: "16:9 · screens",
    width: 1920,
    height: 1080,
    generation: { width: 1344, height: 768 },
  },
};

export const FORMAT_ORDER: FlyerFormat[] = ["poster", "square", "story", "landscape"];

export function aspectRatio(format: FlyerFormat) {
  const { width, height } = FORMATS[format];
  return `${width} / ${height}`;
}
