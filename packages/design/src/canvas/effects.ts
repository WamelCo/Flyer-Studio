import type { ImageNode, PhotoEffects } from "./types";

/**
 * Photo treatments and photo windows, shared by the editor (Konva) and tests. The server
 * renderer (lib/render/svg.ts) draws the same effects with SVG filters.
 */

type Box = { x: number; y: number; width: number; height: number };

/** The source rectangle to show: cover-fit into the frame, or the part of `fitFrame` under the node. */
export function sourceCrop(natural: { width: number; height: number }, node: Pick<ImageNode, "x" | "y" | "width" | "height" | "fitFrame">): Box {
  const frame = node.fitFrame ?? { x: node.x, y: node.y, width: node.width, height: node.height };
  const scale = Math.max(frame.width / natural.width, frame.height / natural.height);
  const ox = frame.x + (frame.width - natural.width * scale) / 2;
  const oy = frame.y + (frame.height - natural.height * scale) / 2;
  const x = Math.max(0, (node.x - ox) / scale);
  const y = Math.max(0, (node.y - oy) / scale);
  return { x, y, width: Math.min(natural.width - x, node.width / scale), height: Math.min(natural.height - y, node.height / scale) };
}

export function rgbOf(color: string | undefined, fallback: [number, number, number]): [number, number, number] {
  const hex = color?.match(/^#([0-9a-f]{6})$/i)?.[1];
  return hex ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] : fallback;
}

export function hasPixelEffects(effects: PhotoEffects | undefined) {
  return Boolean(effects && (effects.tone || effects.dim || effects.grain));
}

/**
 * One pass over the pixels: black-and-white or duotone (luminance mapped between two
 * colours), a darkening veil, then film grain. Grain is seeded, so a design always looks
 * the same.
 */
export function treatPixels(data: Uint8ClampedArray, effects: PhotoEffects) {
  const dark = rgbOf(effects.dark, [16, 16, 20]);
  const light = rgbOf(effects.light, [240, 240, 236]);
  const keep = 1 - (effects.dim ?? 0);
  const grain = (effects.grain ?? 0) * 70;
  let seed = 1234567;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]!;
    let g = data[i + 1]!;
    let b = data[i + 2]!;
    if (effects.tone) {
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (effects.tone === "duotone") {
        r = dark[0] + (light[0] - dark[0]) * l;
        g = dark[1] + (light[1] - dark[1]) * l;
        b = dark[2] + (light[2] - dark[2]) * l;
      } else {
        r = g = b = l * 255;
      }
    }
    if (keep < 1) {
      r *= keep;
      g *= keep;
      b *= keep;
    }
    if (grain) {
      const n = noise() * grain;
      r += n;
      g += n;
      b += n;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

let grainTile: HTMLCanvasElement | null = null;

/** A seeded grey-noise tile for grain textures (browser only). */
export function grainPattern() {
  if (grainTile) return grainTile;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(256, 256);
  let seed = 42;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = (seed >> 8) & 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  grainTile = canvas;
  return canvas;
}
