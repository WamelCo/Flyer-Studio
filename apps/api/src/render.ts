import type { FlyerDoc, ImageNode } from "@flyer/core/canvas/types";
import { checkRender, ideogramConfigured, IdeogramError, renderFlyer, startRender, type RenderQuality } from "@flyer/core/design/ideogram";
import { compileRenderPrompt, type IdeogramPrompt, type RenderMeta } from "@flyer/core/design/render-prompt";

/*
 * The renderer step of generation. The layout engine has already designed each variant
 * (grid, spacing, hierarchy, contrast); here each design is compiled into a structured
 * Ideogram prompt and rendered as a finished graphic. Every variant renders on its own
 * and falls back to its editable engine design on any failure — a generation never
 * fails because the renderer did.
 */

export interface RenderedVariant {
  /** The design delivered to the user: the render as a full-page image, or the engine design. */
  doc: FlyerDoc;
  rendered: boolean;
  /** The structured prompt sent (stored with the job for debugging and reproducibility). */
  prompt?: IdeogramPrompt;
  seed?: number;
  error?: string;
}

/** Stores a rendered image somewhere public and returns its URL (R2 in the API). */
export type StoreRender = (bytes: Uint8Array, index: number) => Promise<string>;

export function renderingEnabled() {
  return ideogramConfigured() && process.env.RENDERER !== "engine";
}

function renderQuality(): RenderQuality {
  const quality = process.env.IDEOGRAM_QUALITY;
  return quality === "medium" || quality === "high" ? quality : "low";
}

/** A one-node document whose page is the rendered design, ready for the editor and export. */
export function renderedDoc(source: FlyerDoc, url: string): FlyerDoc {
  const image: ImageNode = {
    id: `render-${Math.random().toString(36).slice(2, 10)}`,
    name: "Rendered design",
    type: "image",
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    // Kept in place so edits layer on top of it; users can unlock it in the layer panel.
    locked: true,
    src: url,
    width: source.width,
    height: source.height,
    cornerRadius: 0,
  };
  return { version: 1, format: source.format, width: source.width, height: source.height, background: source.background, nodes: [image] };
}

/** Photo slots the engine laid out for the renderer, but which hold no real photo. */
export function withoutPlaceholderPhotos(doc: FlyerDoc): FlyerDoc {
  return { ...doc, nodes: doc.nodes.map((node) => (node.type === "image" && node.src.startsWith("render://") ? { ...node, src: "" } : node)) };
}

export async function renderVariants(
  docs: FlyerDoc[],
  metas: RenderMeta[],
  store: StoreRender,
  options: { timeoutMs?: number } = {},
): Promise<RenderedVariant[]> {
  // Renders are polled, so a slow spell is only a longer wait; this is the overall deadline.
  const timeoutMs = options.timeoutMs ?? 6 * 60_000;
  return Promise.all(
    docs.map(async (doc, index): Promise<RenderedVariant> => {
      const fallback = withoutPlaceholderPhotos(doc);
      let prompt: IdeogramPrompt | undefined;
      try {
        prompt = compileRenderPrompt(doc, metas[index]!);
        const signal = AbortSignal.timeout(timeoutMs);
        const [image] = await renderFlyer(prompt, doc.format, { quality: renderQuality(), signal });
        // Renderer URLs expire: copy the image into our own storage straight away.
        const response = await fetch(image!.url, { signal });
        if (!response.ok) throw new Error(`render download failed (${response.status})`);
        const url = await store(new Uint8Array(await response.arrayBuffer()), index);
        return { doc: renderedDoc(doc, url), rendered: true, prompt, seed: image!.seed };
      } catch (error) {
        const message = error instanceof IdeogramError ? `${error.status}: ${error.message}` : error instanceof Error ? error.message : String(error);
        console.warn(`[render] variant ${index} fell back to the engine design: ${message}`);
        return { doc: fallback, rendered: false, prompt, error: message };
      }
    }),
  );
}

// ── Across HTTP requests (POST starts, GET polls) ──────────────────────────────

/** Starts rendering one engine design; returns Ideogram's generation id. */
export async function startDesignRender(design: FlyerDoc, meta: RenderMeta) {
  const prompt = compileRenderPrompt(design, meta);
  const generationId = await startRender(prompt, design.format, { quality: renderQuality() });
  return { generationId, prompt };
}

export type CollectedRender =
  | { status: "pending" }
  | { status: "done"; url: string; seed: number }
  | { status: "failed"; reason: string };

/**
 * One poll of a started render. When it has finished, the image is copied into storage
 * straight away (renderer URLs expire) and its stored URL returned.
 */
export async function collectRender(generationId: string, store: (bytes: Uint8Array) => Promise<string>): Promise<CollectedRender> {
  const check = await checkRender(generationId, { signal: AbortSignal.timeout(20_000) }).catch(() => ({ status: "pending" }) as const);
  if (check.status === "pending") return check;
  if (check.status === "failed") return { status: "failed", reason: check.reason };
  const image = check.images[0]!;
  const response = await fetch(image.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) return { status: "pending" }; // transient: the next poll tries again
  const url = await store(new Uint8Array(await response.arrayBuffer()));
  return { status: "done", url, seed: image.seed };
}
