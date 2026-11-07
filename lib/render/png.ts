import { Resvg } from "@resvg/resvg-js";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { FlyerDoc } from "@/lib/canvas/types";
import { docBody, docToSvg } from "@/lib/render/svg";

/**
 * Server-side rasterising (resvg, no browser): single designs and the contact sheet the
 * vision critic reviews. Fonts come from assets/fonts (OFL TTFs, scripts/fetch-fonts.mjs);
 * photos are fetched and embedded at review size.
 */

const FONT_DIR = join(process.cwd(), "assets", "fonts");
let fontFiles: string[] | null = null;
const fonts = () => (fontFiles ??= readdirSync(FONT_DIR).filter((f) => f.endsWith(".ttf")).map((f) => join(FONT_DIR, f)));

type ImageMap = Map<string, { data: string; width: number; height: number }>;

/** Unsplash serves any size from the same URL: ask for one close to what we draw. */
function sized(url: string, width: number) {
  return url.startsWith("https://images.unsplash.com/") ? url.replace(/([?&])w=\d+/, `$1w=${width}`) : url;
}

/** Fetch every photo in the docs once, as data URIs. Failures leave the frame empty. */
export async function loadImages(docs: FlyerDoc[], targetWidth = 720): Promise<ImageMap> {
  const urls = [...new Set(docs.flatMap((doc) => doc.nodes.flatMap((n) => (n.type === "image" && n.src ? [n.src] : []))))];
  const images: ImageMap = new Map();
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(sized(url, targetWidth), { signal: AbortSignal.timeout(10_000) });
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

export async function renderPng(doc: FlyerDoc, width = 720, images?: ImageMap) {
  return rasterise(docToSvg(doc, images ?? (await loadImages([doc], width))), width);
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
