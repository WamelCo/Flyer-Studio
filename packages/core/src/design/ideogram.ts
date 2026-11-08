import type { FlyerFormat } from "../canvas/types";
import { RENDER_SIZES, type IdeogramPrompt } from "./render-prompt";

/*
 * Ideogram API v2 (https://developer.ideogram.ai/v2/llms.txt). Renders a compiled
 * structured prompt (render-prompt.ts) with Ideogram 4.5. Server-side only: the key
 * never leaves the API. Image URLs expire, so callers must copy results to storage.
 */

const API = "https://api.ideogram.ai";

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

function renderModel() {
  return process.env.IDEOGRAM_MODEL || "ideogram-4-5";
}

/** Renders `count` images of one structured prompt. Throws IdeogramError on any failure. */
export async function renderFlyer(
  prompt: IdeogramPrompt,
  format: FlyerFormat,
  options: { count?: number; quality?: RenderQuality; seed?: number; signal?: AbortSignal } = {},
): Promise<RenderResult[]> {
  const key = process.env.IDEOGRAM_API_KEY;
  if (!key) throw new IdeogramError("IDEOGRAM_API_KEY is not set", 503);

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
        num_images: options.count ?? 1,
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
    form.append("num_images", String(options.count ?? 1));
    if (options.seed !== undefined) form.append("seed", String(options.seed));
    response = await fetch(`${API}/v2/image/generate/${model}`, { method: "POST", headers: { "Api-Key": key }, body: form, signal: options.signal });
  }

  const body = (await response.json().catch(() => null)) as
    | { data?: { url?: string | null; seed: number; resolution: string; is_image_safe: boolean }[]; error?: string; detail?: string }
    | null;

  if (!response.ok) {
    const message = body?.error ?? body?.detail ?? `Ideogram returned ${response.status}`;
    throw new IdeogramError(message, response.status, response.status === 422);
  }

  const images = (body?.data ?? []).filter((image) => image.is_image_safe && image.url);
  if (images.length === 0) throw new IdeogramError("Ideogram returned no safe images", 422, true);

  return images.map((image) => {
    const [width, height] = image.resolution.split("x").map(Number);
    return { url: image.url!, seed: image.seed, width: width ?? size.width, height: height ?? size.height };
  });
}
