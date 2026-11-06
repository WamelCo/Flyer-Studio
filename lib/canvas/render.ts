"use client";

import type Konva from "konva";

import { FONT_FAMILIES } from "@/lib/canvas/fonts";
import type { FlyerDoc } from "@/lib/canvas/types";

interface RenderOptions {
  /** Output width in pixels; height follows the page aspect ratio. */
  width: number;
  mimeType?: "image/png" | "image/webp" | "image/jpeg";
  quality?: number;
  watermark?: boolean;
}

/**
 * Re-renders the page group (vector, not a screenshot) at the requested resolution.
 * Works for any stage zoom/pan because the region is taken in absolute coordinates.
 */
export async function renderPage(page: Konva.Group, doc: FlyerDoc, options: RenderOptions): Promise<Blob> {
  const { default: KonvaRuntime } = await import("konva");
  const { x, y } = page.getAbsolutePosition();
  const scale = page.getAbsoluteScale().x;
  const region = { x, y, width: doc.width * scale, height: doc.height * scale };

  let mark: Konva.Group | undefined;
  if (options.watermark) {
    const size = Math.round(Math.min(doc.width, doc.height) * 0.028);
    const padding = size * 0.7;
    const label = new KonvaRuntime.Text({
      text: "Made with Flyer Studio",
      fontFamily: FONT_FAMILIES.sans,
      fontStyle: "600",
      fontSize: size,
      fill: "#FFFFFF",
      padding,
    });
    mark = new KonvaRuntime.Group({
      x: doc.width - label.width() - size,
      y: doc.height - label.height() - size,
      opacity: 0.92,
    });
    mark.add(
      new KonvaRuntime.Rect({ width: label.width(), height: label.height(), fill: "rgba(0,0,0,0.55)", cornerRadius: label.height() / 2 }),
      label,
    );
    page.add(mark);
  }

  try {
    const blob = await page.toBlob({
      ...region,
      pixelRatio: options.width / region.width,
      mimeType: options.mimeType ?? "image/png",
      quality: options.quality,
    });
    if (!(blob instanceof Blob)) throw new Error("Render produced no image");
    return blob;
  } finally {
    mark?.destroy();
  }
}
