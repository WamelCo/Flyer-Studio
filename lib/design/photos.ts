import type { FlyerDoc, FlyerFormat } from "@/lib/canvas/types";
import type { StockPhoto } from "@/lib/design/engine";

/**
 * Stock photography from Unsplash (real photos — no image generation). Follows the API
 * guidelines: hotlinked image URLs, photographer credit, and a download ping when a
 * photo is used. Without UNSPLASH_ACCESS_KEY frames stay empty for the user to fill.
 */

const API = "https://api.unsplash.com";
const UTM = "utm_source=flyer_studio&utm_medium=referral";

interface UnsplashPhoto {
  width: number;
  height: number;
  urls: { raw: string };
  links: { download_location: string };
  user: { name: string; links: { html: string } };
}

export interface FoundPhoto extends StockPhoto {
  thumb: string;
  downloadLocation: string;
}

export function photosConfigured() {
  return Boolean(process.env.UNSPLASH_ACCESS_KEY);
}

function orientationFor(format: FlyerFormat) {
  return format === "landscape" ? "landscape" : format === "square" ? "squarish" : "portrait";
}

export async function searchPhotos(query: string, options: { format?: FlyerFormat; perPage?: number; page?: number } = {}): Promise<FoundPhoto[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key || !query.trim()) return [];
  const params = new URLSearchParams({
    query,
    per_page: String(options.perPage ?? 6),
    page: String(options.page ?? 1),
    content_filter: "high",
    ...(options.format && { orientation: orientationFor(options.format) }),
  });
  const response = await fetch(`${API}/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Unsplash search failed (${response.status})`);
  const { results } = (await response.json()) as { results: UnsplashPhoto[] };
  return results.map((photo) => ({
    // Sized for print-quality canvases; the raw URL accepts imgix parameters.
    url: `${photo.urls.raw}&w=2000&q=80&fm=jpg&fit=max`,
    thumb: `${photo.urls.raw}&w=400&q=70&fm=jpg&fit=max`,
    width: photo.width,
    height: photo.height,
    credit: { name: photo.user.name, url: `${photo.user.links.html}?${UTM}` },
    downloadLocation: photo.links.download_location,
  }));
}

/** Unsplash requires a download ping for each photo used in a design. Fire-and-forget. */
export function trackDownloads(photos: Pick<FoundPhoto, "downloadLocation">[]) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return;
  for (const photo of photos) {
    void fetch(photo.downloadLocation, { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  }
}

/** The found photos a composed design actually placed in a frame. */
export function placedPhotos(doc: FlyerDoc, photos: FoundPhoto[]) {
  const used = new Set(doc.nodes.flatMap((node) => (node.type === "image" && node.src ? [node.src] : [])));
  return photos.filter((photo) => used.has(photo.url));
}

/** Most photo frames any layout has (the photo fan uses three, the brochure four). */
const MAX_FRAMES = 4;

/**
 * Photos for each design direction. Each direction takes result `v` of every query
 * (a variety of subjects), then fills its remaining frames from the first query at
 * indices no other direction uses — so the three directions never repeat a photo.
 * One search per query: rate limits count requests, not results.
 */
export async function photosForBrief(queries: string[], format: FlyerFormat, variations: number): Promise<FoundPhoto[][]> {
  const unique = [...new Set(queries.map((q) => q.trim().toLowerCase()).filter(Boolean))].slice(0, 3);
  if (!photosConfigured() || !unique.length) return Array.from({ length: variations }, () => []);
  const results = await Promise.all(
    unique.map((q, i) => searchPhotos(q, { format, perPage: i === 0 ? variations * MAX_FRAMES : variations }).catch(() => [])),
  );
  return Array.from({ length: variations }, (_, v) => {
    const picks = results.flatMap((list) => (list[v] ? [list[v]] : []));
    const first = results[0] ?? [];
    for (let i = variations + v; i < first.length && picks.length < MAX_FRAMES; i += variations) picks.push(first[i]!);
    return picks;
  });
}
