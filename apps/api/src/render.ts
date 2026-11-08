import type { FlyerDoc, ImageNode } from "@flyer/core/canvas/types";
import { ideogramConfigured, IdeogramError, renderFlyer, type RenderQuality } from "@flyer/core/design/ideogram";
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
  const timeoutMs = options.timeoutMs ?? 120_000;
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
