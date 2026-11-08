import type { ColorShare } from "@flyer/core/design/reference";
import sharp from "sharp";

/**
 * Image utilities: dominant colours of a reference, edit masks for revisions, and pixel
 * diffs (proof that a revision changed only what was asked).
 */

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** The image's dominant colours, most prominent first (quantised, near-duplicates merged). */
export async function dominantColors(bytes: Uint8Array, count = 8): Promise<ColorShare[]> {
  const { data, info } = await sharp(bytes).resize(64, 64, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  const merged: { r: number; g: number; b: number; n: number }[] = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    const c = { r: bucket.r / bucket.n, g: bucket.g / bucket.n, b: bucket.b / bucket.n, n: bucket.n };
    const near = merged.find((m) => Math.hypot(m.r - c.r, m.g - c.g, m.b - c.b) < 42);
    if (near) {
      const n = near.n + c.n;
      near.r = (near.r * near.n + c.r * c.n) / n;
      near.g = (near.g * near.n + c.g * c.n) / n;
      near.b = (near.b * near.n + c.b * c.n) / n;
      near.n = n;
    } else merged.push(c);
  }
  return merged
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((c) => ({ hex: hex(c.r, c.g, c.b), share: c.n / total }));
}

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A precise-edit mask: black where the edit may happen, white everywhere else. */
export async function editMask(width: number, height: number, boxes: PixelBox[]): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height, 255);
  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(width, Math.ceil(box.x + box.width));
    const y1 = Math.min(height, Math.ceil(box.y + box.height));
    for (let y = y0; y < y1; y++) pixels.fill(0, y * width + x0, y * width + x1);
  }
  return new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer());
}

export async function imageSize(bytes: Uint8Array) {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0, type: meta.format === "jpeg" ? "image/jpeg" : meta.format === "webp" ? "image/webp" : "image/png" };
}

/**
 * Where two images differ: the share of changed pixels, their bounding box, and how much
 * of the change fell inside the boxes that were meant to change.
 */
export async function pixelDiff(before: Uint8Array, after: Uint8Array, intended: PixelBox[] = [], threshold = 28) {
  const a = await sharp(before).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(after).resize(a.info.width, a.info.height).removeAlpha().raw().toBuffer();
  const { width, height } = a.info;
  let changed = 0;
  let inside = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  const within = (x: number, y: number) => intended.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const d = Math.max(Math.abs(a.data[i]! - b[i]!), Math.abs(a.data[i + 1]! - b[i + 1]!), Math.abs(a.data[i + 2]! - b[i + 2]!));
      if (d <= threshold) continue;
      changed += 1;
      if (intended.length && within(x, y)) inside += 1;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return {
    changedShare: changed / (width * height),
    changedBox: changed ? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } : null,
    insideIntended: intended.length && changed ? inside / changed : null,
  };
}
