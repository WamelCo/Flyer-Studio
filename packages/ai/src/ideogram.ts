import { FORMATS } from "@flyer/design/canvas/formats";
import type { FlyerDoc, FlyerFormat } from "@flyer/design/canvas/types";
import type { DesignBrief } from "./brief";
import type { DesignCopy } from "@flyer/design/engine";
import { copyItems, ideogramDoc, type DetectedTextBlock } from "./ideogram-layers";
import type { Palette } from "@flyer/design/palettes";
import type { Pairing } from "@flyer/design/typography";
import { putObject } from "@flyer/storage";

/**
 * Ideogram 4.5 as the lead design direction. The art director (Qwen/Claude) writes the
 * brief and the exact copy; Ideogram designs the flyer around it; Layerize lifts the
 * text off the artwork so it becomes editable layers (see ideogram-layers.ts).
 *
 *   IDEOGRAM_API_KEY   required (prepaid credits on the Ideogram developer account)
 *   IDEOGRAM_QUALITY   optional: low | medium | high (default medium) — price scales with it
 */

/** Overridable for tests (a mock server); production always uses Ideogram's API. */
const api = () => process.env.IDEOGRAM_BASE_URL || "https://api.ideogram.ai";
const GENERATE_TIMEOUT_MS = 55_000;
const LAYERIZE_TIMEOUT_MS = 40_000;

export function ideogramConfigured() {
  return Boolean(process.env.IDEOGRAM_API_KEY);
}

/**
 * Without reference images Ideogram 4.5 accepts only its own 1K/2K size presets ("this
 * resolution is not supported" otherwise), and bills every size the same per quality
 * level — so we always ask for 2K. Presets confirmed with free dry runs (Nov 8, 2026).
 */
export const IDEOGRAM_SIZES = [
  { width: 2048, height: 2048 }, // 1:1
  { width: 1728, height: 2304 }, // 3:4
  { width: 2304, height: 1728 }, // 4:3
  { width: 1664, height: 2496 }, // 2:3
  { width: 2496, height: 1664 }, // 3:2
  { width: 1440, height: 2560 }, // 9:16
  { width: 2560, height: 1440 }, // 16:9
  { width: 1440, height: 2880 }, // 1:2
  { width: 2880, height: 1440 }, // 2:1
] as const;

/**
 * The preset closest in shape to the format. A4 has no exact preset: the artwork is
 * cover-cropped onto the page (~3% off two edges) and the text layers follow the same
 * crop (ideogram-layers.ts).
 */
export function ideogramSize(format: FlyerFormat) {
  const { width, height } = FORMATS[format];
  const distance = (s: { width: number; height: number }) => Math.abs(Math.log(s.width / s.height / (width / height)));
  const best = [...IDEOGRAM_SIZES].sort((a, b) => distance(a) - distance(b))[0]!;
  return { width: best.width, height: best.height };
}

const FORMAT_WORDS: Record<FlyerFormat, string> = {
  poster: "portrait A4 print flyer",
  square: "square social media post",
  story: "vertical 9:16 story graphic",
  landscape: "landscape 16:9 screen graphic",
};

/**
 * The Ideogram prompt: the art director's visual concept, then every line of copy in
 * quotes (Ideogram sets quoted text verbatim), then the design system to honour.
 * Magic Prompt stays off, so Ideogram can't add words or details of its own.
 */
export function ideogramPrompt(brief: DesignBrief, copy: DesignCopy, format: FlyerFormat, palette: Palette, pairing: Pairing) {
  const roles: Record<string, string> = {
    headline: "dominant headline",
    eyebrow: "small lead-in above the headline",
    subhead: "subheading under the headline",
    details: "details line",
    cta: "call-to-action button",
    brand: "brand name, small",
    contact: "contact line, small",
  };
  const lines = copyItems(copy).map((item) => `- ${roles[item.kind] ?? item.kind}: "${item.text}"`);
  const colours = [palette.primary, palette.accent, palette.bg, palette.dark].join(", ");
  return [
    `A professionally designed ${FORMAT_WORDS[format]} for ${brief.category.replace("_", " ")}, made by a senior graphic designer.`,
    brief.artwork,
    brief.requirements.length ? `Design requirements from the client (honour them; do not write them as text): ${brief.requirements.join("; ")}.` : "",
    `The flyer contains exactly this text, spelled exactly as written, and no other words, letters, logos or watermarks:`,
    ...lines,
    `Typography: ${pairing.mood.toLowerCase()}; one clear hierarchy with the headline largest, crisp and highly legible, generous margins, nothing touching the edges.`,
    `Colour palette: ${palette.name} (${colours}) — ${palette.mood.toLowerCase()}.`,
    `Mood: ${brief.tone.join(", ") || "confident"}. Balanced, uncluttered composition with strong contrast between text and background.`,
  ]
    .filter(Boolean)
    .join("\n");
}

class IdeogramError extends Error {}

async function call(path: string, form: FormData, timeoutMs: number) {
  const response = await fetch(`${api()}${path}`, {
    method: "POST",
    headers: { "Api-Key": process.env.IDEOGRAM_API_KEY! },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    const hint = response.status === 401 ? " (check IDEOGRAM_API_KEY)" : response.status === 402 ? " (add credits to the Ideogram account)" : response.status === 422 ? " (prompt failed Ideogram's safety check)" : "";
    throw new IdeogramError(`${path}: HTTP ${response.status}${hint} ${detail}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new IdeogramError(`download failed: HTTP ${response.status}`);
  const type = response.headers.get("content-type")?.split(";")[0] ?? "image/png";
  return { bytes: new Uint8Array(await response.arrayBuffer()), type };
}

interface Generated {
  url: string;
  width: number;
  height: number;
}

export async function generateDesign(prompt: string, format: FlyerFormat): Promise<Generated> {
  const size = ideogramSize(format);
  const form = new FormData();
  form.set("prompt", prompt);
  form.set("magic_prompt", "off");
  form.set("size", `${size.width}x${size.height}`);
  form.set("quality", process.env.IDEOGRAM_QUALITY || "medium");
  form.set("num_images", "1");
  form.set("background", "opaque");
  const result = await call("/v2/image/generate/ideogram-4-5", form, GENERATE_TIMEOUT_MS);
  const image = (result.data as { url?: string | null; is_image_safe?: boolean; resolution?: string }[] | undefined)?.[0];
  if (!image?.url || image.is_image_safe === false) throw new IdeogramError("Ideogram returned no safe image");
  const [w, h] = (image.resolution ?? `${size.width}x${size.height}`).split("x").map(Number);
  return { url: image.url, width: w || size.width, height: h || size.height };
}

interface Layerized {
  baseImageUrl: string;
  blocks: DetectedTextBlock[];
  width: number;
  height: number;
}

export async function layerize(image: { bytes: Uint8Array; type: string }, prompt: string): Promise<Layerized> {
  const form = new FormData();
  form.set("image", new Blob([image.bytes as BlobPart], { type: image.type }), `flyer.${image.type.split("/")[1] ?? "png"}`);
  form.set("prompt", prompt);
  const result = await call("/v2/design/layerize/ideogram-3", form, LAYERIZE_TIMEOUT_MS);
  const layer = (result.data as { base_image_url?: string; text_blocks?: DetectedTextBlock[]; resolution?: string }[] | undefined)?.[0];
  if (!layer?.base_image_url) throw new IdeogramError("Layerize returned no base image");
  const [w, h] = (layer.resolution ?? "").split("x").map(Number);
  return { baseImageUrl: layer.base_image_url, blocks: layer.text_blocks ?? [], width: w || 0, height: h || 0 };
}

/** Ideogram's links expire: keep the artwork in the user's own folder of our bucket. */
async function store(image: { bytes: Uint8Array; type: string }, userId: string, jobId: string) {
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[image.type] ?? "png";
  const path = `${userId}/ideogram/${jobId}.${extension}`;
  try {
    return await putObject("public", path, image.bytes, { contentType: image.type, cacheControl: "public, max-age=31536000, immutable" });
  } catch (error) {
    throw new IdeogramError(`storing artwork failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface IdeogramInput {
  brief: DesignBrief;
  copy: DesignCopy;
  format: FlyerFormat;
  palette: Palette;
  pairing: Pairing;
  userId: string;
  jobId: string;
}

/**
 * The full pipeline for the lead direction. Never throws: on any failure (no credits,
 * timeout, safety flag, nothing recognisable) it returns null and the layout engine
 * designs that direction instead.
 */
export async function ideogramDirection(
  input: IdeogramInput,
  deps: { store?: typeof store } = {},
): Promise<{ doc: FlyerDoc; prompt: string } | null> {
  if (!ideogramConfigured()) return null;
  const prompt = ideogramPrompt(input.brief, input.copy, input.format, input.palette, input.pairing);
  const started = Date.now();
  try {
    const generated = await generateDesign(prompt, input.format);
    const original = await download(generated.url);
    const layers = await layerize(original, copyItems(input.copy).map((i) => i.text).join("\n"));
    const base = await download(layers.baseImageUrl);
    const artworkUrl = await (deps.store ?? store)(base, input.userId, input.jobId);
    const { doc, kept, dropped } = ideogramDoc({
      format: input.format,
      artworkUrl,
      imageWidth: layers.width || generated.width,
      imageHeight: layers.height || generated.height,
      blocks: layers.blocks,
      copy: input.copy,
      palette: input.palette,
      pairing: input.pairing,
    });
    if (!kept) throw new IdeogramError(`no approved text recognised (dropped: ${dropped.join(" | ").slice(0, 200)})`);
    if (dropped.length) console.info(`[ideogram] dropped ${dropped.length} unapproved text block(s): ${dropped.join(" | ").slice(0, 200)}`);
    console.info(`[ideogram] designed in ${((Date.now() - started) / 1000).toFixed(1)}s, ${kept} text layer(s)`);
    return { doc, prompt };
  } catch (error) {
    console.error("[ideogram] direction failed, using the layout engine:", error instanceof Error ? error.message : error);
    return null;
  }
}
