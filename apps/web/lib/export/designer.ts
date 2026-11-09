import type { BlendMode as PsdBlendMode, Layer, Psd } from "ag-psd";
import type Konva from "konva";

import { FORMATS } from "@flyer/design/canvas/formats";
import type { BlendMode, FlyerDoc, TextNode } from "@flyer/design/canvas/types";
import { textLines } from "@flyer/design/geometry";
import { postscriptName } from "@flyer/design/render/fonts";
import { photoAtWidth } from "@flyer/design/render/photo-url";
import { docToSvg } from "@flyer/design/render/svg";

/**
 * Editable files for designers who finish a flyer in their own tools:
 *  - Illustrator (SVG): vectors, named objects and live text; photos embedded.
 *  - Photoshop (PSD): one layer per canvas element, in order, with live text layers.
 * Fonts are referenced by PostScript name (all free Google Fonts — see fontsUsed()).
 */

// ── Illustrator / Figma: SVG ────────────────────────────────────────────────

async function dataUri(url: string) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`photo ${response.status}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The document as an editable SVG, photos embedded at print size (a file must stand alone). */
export async function svgFile(doc: FlyerDoc, title: string) {
  const urls = [...new Set(doc.nodes.flatMap((n) => (n.type === "image" && n.src && !n.hidden ? [n.src] : [])))];
  const images = new Map<string, { data: string; width: number; height: number }>();
  await Promise.all(
    urls.map(async (url) => {
      const frame = doc.nodes.find((n) => n.type === "image" && n.src === url)!;
      // ~300 dpi for the frame on an A4 page; a photo that can't be fetched stays an empty frame.
      const width = Math.min(3000, Math.max(1200, Math.round(frame.width * 2.5)));
      images.set(url, { data: await dataUri(photoAtWidth(url, width)).catch(() => dataUri(url)), width: 0, height: 0 });
    }),
  );
  return new Blob([docToSvg(doc, images, { designer: true, title })], { type: "image/svg+xml" });
}

// ── Photoshop: PSD ──────────────────────────────────────────────────────────

const PSD_BLEND: Record<BlendMode, PsdBlendMode> = { multiply: "multiply", screen: "screen", overlay: "overlay", "soft-light": "soft light", darken: "darken", lighten: "lighten" };

/** One element's pixels, cropped to its bounds, in PSD coordinates. */
export interface LayerPixels {
  left: number;
  top: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function rgb(color: string) {
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  const parts = color.match(/^rgba?\(([^)]+)\)$/)?.[1]?.split(",").map((s) => Number(s.trim()));
  if (parts && parts.length >= 3) return { r: parts[0]!, g: parts[1]!, b: parts[2]! };
  return { r: 0, g: 0, b: 0 };
}

function solid(width: number, height: number, color: string): LayerPixels {
  const { r, g, b } = rgb(color);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { left: 0, top: 0, width, height, data };
}

/**
 * A live Photoshop text layer: paragraph ("box") text, so retyped copy wraps inside its
 * frame and keeps its alignment. Its pixels are our rendering; Photoshop asks to update
 * text layers on open and then sets them with the designer's installed fonts.
 */
function textData(node: TextNode, scale: number): Layer["text"] {
  const t = ((node.rotation ?? 0) * Math.PI) / 180;
  const lineHeight = node.fontSize * node.lineHeight;
  // One spare line: Photoshop's metrics differ slightly, and a short box hides overflow.
  const boxHeight = (textLines(node).length + 1) * lineHeight;
  return {
    text: node.text,
    transform: [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), node.x * scale, node.y * scale],
    shapeType: "box",
    boxBounds: [0, 0, node.width * scale, boxHeight * scale],
    antiAlias: "smooth",
    style: {
      font: { name: postscriptName(node) },
      fontSize: node.fontSize * scale,
      fillColor: rgb(node.fill),
      autoLeading: false,
      leading: lineHeight * scale,
      tracking: Math.round((node.letterSpacing / node.fontSize) * 1000),
      fontCaps: node.uppercase ? 2 : 0, // all caps, keeping the typed text as written
      ...(node.stroke && {
        strokeFlag: true,
        strokeColor: rgb(node.stroke.color),
        outlineWidth: node.stroke.width * scale,
        fillFlag: node.fill !== "transparent",
      }),
    },
    paragraphStyle: { justification: node.align === "center" ? "center" : node.align === "right" ? "right" : "left" },
  };
}

/**
 * The PSD, bottom layer first: the page colour, then every element in the editor's
 * stacking order. Pure — callers supply each element's pixels (browser: Konva).
 */
export function psdDocument(doc: FlyerDoc, width: number, pixels: Map<string, LayerPixels>, composite: LayerPixels): Psd {
  const scale = width / doc.width;
  const height = Math.round(doc.height * scale);
  const inches = FORMATS[doc.format].pdfPoints ? FORMATS[doc.format].pdfPoints!.width / 72 : null;
  const dpi = inches ? Math.round(width / inches) : 72;
  const background = solid(width, height, doc.background);

  const layers: Layer[] = [{ name: "Background", left: 0, top: 0, imageData: background, protected: { position: true } }];
  for (const node of doc.nodes) {
    const raster = pixels.get(node.id);
    if (!raster) continue; // nothing on the page (empty text, fully off-canvas)
    layers.push({
      name: node.name || node.type,
      left: raster.left,
      top: raster.top,
      imageData: { width: raster.width, height: raster.height, data: raster.data },
      opacity: node.opacity,
      hidden: Boolean(node.hidden),
      ...(node.locked && { protected: { position: true } }),
      ...(node.blend && { blendMode: PSD_BLEND[node.blend] }),
      ...(node.type === "text" && { text: textData(node, scale) }),
    });
  }
  // The flattened preview is optional for Photoshop; one of the wrong size would make the file invalid.
  const preview = composite.width === width && composite.height === height;
  return {
    width,
    height,
    ...(preview && { imageData: { width, height, data: composite.data } }),
    children: layers,
    imageResources: {
      resolutionInfo: { horizontalResolution: dpi, horizontalResolutionUnit: "PPI", widthUnit: "Inches", verticalResolution: dpi, verticalResolutionUnit: "PPI", heightUnit: "Inches" },
    },
  };
}

/** Each element's pixels from the live canvas, cropped to its bounds (browser only). */
export function rasterLayers(page: Konva.Group, doc: FlyerDoc, width: number) {
  const stageScale = page.getAbsoluteScale().x;
  const origin = page.getAbsolutePosition();
  const scale = width / doc.width;
  const height = Math.round(doc.height * scale);
  const pixelRatio = scale / stageScale;
  const toStage = (px: number) => (px / scale) * stageScale;

  const read = (canvas: HTMLCanvasElement, left: number, top: number): LayerPixels => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return { left, top, width: canvas.width, height: canvas.height, data };
  };

  const pixels = new Map<string, LayerPixels>();
  for (const node of doc.nodes) {
    const shape = page.findOne(`#${node.id}`);
    if (!shape) continue;
    // Opacity and visibility become layer settings, so render the element at full strength.
    const visible = shape.visible();
    const opacity = shape.opacity();
    shape.visible(true);
    shape.opacity(1);
    try {
      const box = shape.getClientRect({ relativeTo: page });
      const left = Math.max(0, Math.floor(box.x * scale));
      const top = Math.max(0, Math.floor(box.y * scale));
      const right = Math.min(width, Math.ceil((box.x + box.width) * scale));
      const bottom = Math.min(height, Math.ceil((box.y + box.height) * scale));
      if (right <= left || bottom <= top) continue;
      const canvas = shape.toCanvas({ x: origin.x + toStage(left), y: origin.y + toStage(top), width: toStage(right - left), height: toStage(bottom - top), pixelRatio });
      pixels.set(node.id, read(canvas, left, top));
    } finally {
      shape.visible(visible);
      shape.opacity(opacity);
    }
  }
  // Konva rounds the canvas size its own way; the composite must match the PSD exactly.
  const rendered = page.toCanvas({ x: origin.x, y: origin.y, width: doc.width * stageScale, height: doc.height * stageScale, pixelRatio });
  const exact = document.createElement("canvas");
  exact.width = width;
  exact.height = height;
  exact.getContext("2d")!.drawImage(rendered, 0, 0, width, height);
  return { pixels, composite: read(exact, 0, 0) };
}

export async function psdFile(page: Konva.Group, doc: FlyerDoc, width: number) {
  const { writePsd } = await import("ag-psd");
  const { pixels, composite } = rasterLayers(page, doc, width);
  const bytes = writePsd(psdDocument(doc, width, pixels, composite), { generateThumbnail: false });
  return new Blob([bytes], { type: "image/vnd.adobe.photoshop" });
}
