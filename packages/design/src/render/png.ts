import { Resvg } from "@resvg/resvg-js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { FlyerDoc } from "../canvas/types";
import { photoAtWidth } from "./photo-url";
import { docBody, docToSvg } from "./svg";

/**
 * Server-side rasterising (resvg, no browser): single designs and the contact sheet the
 * vision critic reviews. Fonts come from assets/fonts (OFL TTFs, scripts/fetch-fonts.mjs);
 * photos are fetched and embedded at review size.
 */

/** packages/design/assets/fonts, wherever this runs from: FLYER_FONTS_DIR (Docker), the package itself, or an app depending on it. */
export function fontDir() {
  const cwd = process.cwd();
  const candidates = [
    process.env.FLYER_FONTS_DIR,
    join(cwd, "assets", "fonts"),
    join(cwd, "node_modules", "@flyer", "design", "assets", "fonts"),
    join(cwd, "packages", "design", "assets", "fonts"),
    join(cwd, "..", "..", "packages", "design", "assets", "fonts"),
  ];
  const found = candidates.find((dir): dir is string => Boolean(dir && existsSync(join(dir, "families.json"))));
  if (!found) throw new Error("Font files not found: set FLYER_FONTS_DIR to packages/design/assets/fonts");
  return found;
}
let fontFiles: string[] | null = null;
const fonts = () => {
  if (fontFiles) return fontFiles;
  const dir = fontDir();
  return (fontFiles = readdirSync(dir).filter((f) => f.endsWith(".ttf")).map((f) => join(dir, f)));
};

type ImageMap = Map<string, { data: string; width: number; height: number }>;


/** Fetch every photo in the docs once, as data URIs. Failures leave the frame empty. */
export async function loadImages(docs: FlyerDoc[], targetWidth = 720): Promise<ImageMap> {
  const urls = [...new Set(docs.flatMap((doc) => doc.nodes.flatMap((n) => (n.type === "image" && n.src ? [n.src] : []))))];
  const images: ImageMap = new Map();
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(photoAtWidth(url, targetWidth), { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return;
        const type = response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
        const bytes = Buffer.from(await response.arrayBuffer());
        images.set(url, { data: `data:${type};base64,${bytes.toString("base64")}`, width: 0, height: 0 });
      } catch {
        // A missing photo renders as an empty frame; the critic and lint still run.
      }
    }),
  );
  return images;
}

function rasterise(svg: string, width: number) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.round(width) },
    font: { fontFiles: fonts(), loadSystemFonts: false, defaultFontFamily: "Inter" },
    imageRendering: 0,
    shapeRendering: 2,
    textRendering: 1,
  });
  return resvg.render().asPng();
}

/**
 * The Free-plan mark, drawn like the editor's export watermark (lib/canvas/render.ts on the
 * web): "Made with Flyer Studio" on a dark pill in the bottom-right corner.
 */
export function watermarkSvg(doc: FlyerDoc) {
  const size = Math.round(Math.min(doc.width, doc.height) * 0.028);
  const padding = size * 0.7;
  const label = "Made with Flyer Studio";
  const width = label.length * size * 0.56 + padding * 2;
  const height = size * 1.2 + padding * 2;
  const x = doc.width - width - size;
  const y = doc.height - height - size;
  return `<g opacity="0.92"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#000" fill-opacity="0.55"/><text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="central" font-family="Inter" font-weight="600" font-size="${size}" fill="#FFFFFF">${label}</text></g>`;
}

export async function renderPng(doc: FlyerDoc, width = 720, images?: ImageMap, { watermark = false }: { watermark?: boolean } = {}) {
  let svg = docToSvg(doc, images ?? (await loadImages([doc], width)));
  if (watermark) svg = svg.replace(/<\/svg>$/, `${watermarkSvg(doc)}</svg>`);
  return rasterise(svg, width);
}

/**
 * The designs side by side, numbered, on a neutral board — the view a creative director
 * reviews. Kept wide (~1100 px): the vision model bills a wide image far less than a
 * portrait one. Landscape designs go in a 2-column grid so they stay legible.
 */
export async function renderSheet(docs: FlyerDoc[], images?: ImageMap, layout: { columns?: number; cellWidth?: number; labels?: string[] } = {}) {
  const loaded = images ?? (await loadImages(docs));
  const aspect = docs[0]!.width / docs[0]!.height;
  const columns = layout.columns ?? (aspect > 1.2 ? 2 : docs.length);
  const rows = Math.ceil(docs.length / columns);
  const gap = 24;
  const label = 40;
  const cellWidth = layout.cellWidth ?? (aspect > 1.2 ? 560 : Math.round(1100 / docs.length));
  const cellHeight = Math.round(cellWidth / aspect);
  const width = columns * cellWidth + (columns + 1) * gap;
  const height = rows * (cellHeight + label) + (rows + 1) * gap;

  const cells = docs.map((doc, i) => {
    const x = gap + (i % columns) * (cellWidth + gap);
    const y = gap + Math.floor(i / columns) * (cellHeight + label + gap);
    const scale = cellWidth / doc.width;
    return `<text x="${x}" y="${y + 28}" font-family="Inter" font-size="26" font-weight="700" fill="#1D1D1F">${layout.labels?.[i] ?? i + 1}</text><g transform="translate(${x} ${y + label}) scale(${scale})">${docBody(doc, loaded, `d${i}`)}</g>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#E8E8ED"/>${cells.join("")}</svg>`;
  return { png: rasterise(svg, width), width, height };
}
