import type { FlyerFormat } from "../canvas/types";
import { RENDER_SIZES, type IdeogramPrompt } from "./render-prompt";

/*
 * Ideogram API v2 (https://developer.ideogram.ai/v2/llms.txt). Renders a compiled
 * structured prompt (render-prompt.ts) with Ideogram 4.5. Server-side only: the key
 * never leaves the API. Image URLs expire, so callers must copy results to storage.
 *
 * Renders always run asynchronously: startRender() returns a generation id at once and
 * checkRender() polls it. Ideogram takes 15–130s per image and has slow spells, so no
 * request ever has to stay open for a render.
 */

/** Overridable for tests (a local mock of the API). */
const API = (process.env.IDEOGRAM_BASE_URL || "https://api.ideogram.ai").replace(/\/$/, "");

/**
 * Ideogram 4.5 bills by quality, not size: low $0.03, medium $0.06, high $0.10 per image
 * (dry-run quotes, Nov 2026). With our structured prompts, low keeps the layout, copy and
 * typefaces of high (A/B tested), so it is the default.
 */
export type RenderQuality = "low" | "medium" | "high";

export interface RenderResult {
  url: string;
  seed: number;
  width: number;
  height: number;
}

export type RenderCheck =
  | { status: "pending" }
  | { status: "completed"; images: RenderResult[] }
  | { status: "failed"; reason: string; blocked: boolean };

export class IdeogramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Safety rejection (prompt 422 or an unsafe image): show the generic refusal message. */
    readonly blocked = false,
  ) {
    super(message);
  }
}

export function ideogramConfigured() {
  return Boolean(process.env.IDEOGRAM_API_KEY);
}

function apiKey() {
  const key = process.env.IDEOGRAM_API_KEY;
  if (!key) throw new IdeogramError("IDEOGRAM_API_KEY is not set", 503);
  return key;
}

function renderModel() {
  return process.env.IDEOGRAM_MODEL || "ideogram-4-5";
}

async function errorFrom(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null;
  return new IdeogramError(body?.error ?? body?.detail ?? `Ideogram returned ${response.status}`, response.status, response.status === 422);
}

/** Starts one render and returns its generation id. Throws IdeogramError if not accepted. */
export async function startRender(
  prompt: IdeogramPrompt,
  format: FlyerFormat,
  options: { quality?: RenderQuality; seed?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const key = apiKey();
  const size = RENDER_SIZES[format];
  const model = renderModel();
  const promptText = JSON.stringify(prompt);
  let response: Response;

  if (model === "ideogram-4") {
    // 4.0 takes JSON bodies and names its size `resolution`.
    response = await fetch(`${API}/v2/image/generate/ideogram-4`, {
      method: "POST",
      headers: { "Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptText,
        magic_prompt: "off",
        resolution: `${size.width}x${size.height}`,
        rendering_speed: options.quality === "high" ? "quality" : options.quality === "medium" ? "default" : "turbo",
        async: true,
        ...(options.seed !== undefined && { seed: options.seed }),
      }),
      signal: options.signal,
    });
  } else {
    // 4.5 is multipart. Magic prompt off: our JSON is the brief, verbatim.
    const form = new FormData();
    form.append("prompt", promptText);
    form.append("magic_prompt", "off");
    form.append("size", `${size.width}x${size.height}`);
    form.append("quality", options.quality ?? "low");
    form.append("background", "opaque");
    form.append("async", "true");
    if (options.seed !== undefined) form.append("seed", String(options.seed));
    response = await fetch(`${API}/v2/image/generate/${model}`, { method: "POST", headers: { "Api-Key": key }, body: form, signal: options.signal });
  }

  if (!response.ok) throw await errorFrom(response);
  const body = (await response.json().catch(() => null)) as { generation_id?: string } | null;
  if (!body?.generation_id) throw new IdeogramError("Ideogram accepted the render but returned no generation id", 502);
  return body.generation_id;
}

/** One poll of a render. Network or rate-limit trouble reads as still pending. */
export async function checkRender(generationId: string, options: { signal?: AbortSignal } = {}): Promise<RenderCheck> {
  let response: Response;
  try {
    response = await fetch(`${API}/v2/generations/${encodeURIComponent(generationId)}`, { headers: { "Api-Key": apiKey() }, signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { status: "pending" };
  }
  if (response.status === 429 || response.status >= 500) return { status: "pending" };
  if (!response.ok) {
    const error = await errorFrom(response);
    return { status: "failed", reason: error.message, blocked: false };
  }

  const body = (await response.json()) as {
    status: "pending" | "completed" | "failed";
    failure_reason?: string;
    data?: { url?: string | null; seed?: number; resolution?: string; is_image_safe?: boolean }[];
  };
  if (body.status === "pending") return { status: "pending" };
  if (body.status === "failed") {
    const reason = body.failure_reason ?? "failed";
    return { status: "failed", reason, blocked: /policy|safety|unsafe/i.test(reason) };
  }

  const images = (body.data ?? [])
    .filter((image) => image.is_image_safe !== false && image.url)
    .map((image) => {
      const [width, height] = (image.resolution ?? "").split("x").map(Number);
      return { url: image.url!, seed: image.seed ?? 0, width: width || 0, height: height || 0 };
    });
  if (images.length === 0) return { status: "failed", reason: "no safe image returned", blocked: true };
  return { status: "completed", images };
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/**
 * Starts a render and polls until it finishes (for scripts and other long-lived callers;
 * the API's HTTP routes use startRender/checkRender across requests instead).
 */
export async function renderFlyer(
  prompt: IdeogramPrompt,
  format: FlyerFormat,
  options: { quality?: RenderQuality; seed?: number; signal?: AbortSignal; pollMs?: number } = {},
): Promise<RenderResult[]> {
  const generationId = await startRender(prompt, format, options);
  for (;;) {
    await pause(options.pollMs ?? (Number(process.env.IDEOGRAM_POLL_MS) || 3_000), options.signal);
    const check = await checkRender(generationId, { signal: options.signal });
    if (check.status === "completed") return check.images;
    if (check.status === "failed") throw new IdeogramError(`Render failed: ${check.reason}`, 502, check.blocked);
  }
}

// ── References and revisions ───────────────────────────────────────────────────

export interface ImageFile {
  bytes: Uint8Array;
  /** image/png, image/jpeg or image/webp */
  type: string;
}

const fileOf = (image: ImageFile, _name: string) => new Blob([new Uint8Array(image.bytes)], { type: image.type });

/**
 * Reads an image (a reference flyer) into Ideogram's structured prompt format, with a
 * style description: the same vocabulary our compiler writes, so its style transfers.
 */
export async function describeReference(image: ImageFile, options: { signal?: AbortSignal } = {}): Promise<{
  high_level_description?: string;
  style_description?: { aesthetics?: string; art_style?: string; medium?: string; lighting?: string; color_palette?: string[] };
  compositional_deconstruction?: { background?: string; elements?: { desc?: string }[] };
}> {
  const form = new FormData();
  form.append("image", fileOf(image, "reference"), "reference");
  form.append("include_style_descriptions", "true");
  form.append("include_bbox", "false");
  const response = await fetch(`${API}/v2/image/describe/ideogram-4`, { method: "POST", headers: { "Api-Key": apiKey() }, body: form, signal: options.signal });
  if (!response.ok) throw await errorFrom(response);
  const body = (await response.json()) as { json_prompt?: Record<string, unknown> };
  return (body.json_prompt ?? {}) as Awaited<ReturnType<typeof describeReference>>;
}

/**
 * Starts a precise edit (Ideogram 4.5): only what the instruction changes is redrawn;
 * every other pixel is copied from the source. A mask (black = edit, white = keep)
 * confines the edit further. Poll the returned id with checkRender().
 * Prices by quality only: very_low $0.008, low $0.03, medium $0.06, high $0.22.
 */
export async function startPreciseEdit(
  image: ImageFile,
  instruction: string,
  options: { mask?: ImageFile; quality?: "very_low" | "low" | "medium" | "high"; signal?: AbortSignal } = {},
): Promise<string> {
  const form = new FormData();
  form.append("prompt", instruction);
  form.append("image", fileOf(image, "image"), "image");
  if (options.mask) form.append("mask", fileOf(options.mask, "mask"), "mask.png");
  form.append("quality", options.quality ?? "low");
  form.append("async", "true");
  const response = await fetch(`${API}/v2/image/precise-edit/ideogram-4-5`, { method: "POST", headers: { "Api-Key": apiKey() }, body: form, signal: options.signal });
  if (!response.ok) throw await errorFrom(response);
  const body = (await response.json().catch(() => null)) as { generation_id?: string } | null;
  if (!body?.generation_id) throw new IdeogramError("Ideogram accepted the edit but returned no generation id", 502);
  return body.generation_id;
}
