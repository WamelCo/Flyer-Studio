"use client";

import type Konva from "konva";

import { apiFetch } from "@/lib/api/client";
import { renderPage } from "@/lib/canvas/render";
import type { FlyerDoc } from "@flyer/design/canvas/types";

const THUMBNAIL_WIDTH = 480;

/** Renders a small WebP of the page and stores it as the project's grid thumbnail. */
export async function saveThumbnail(page: Konva.Group, doc: FlyerDoc, { projectId }: { projectId: string }) {
  const blob = await renderPage(page, doc, { width: THUMBNAIL_WIDTH, mimeType: "image/webp", quality: 0.85 });
  return (await apiFetch<{ url: string }>(`/api/projects/${projectId}/thumbnail`, { method: "POST", body: blob, headers: { "Content-Type": "image/webp" } })).url;
}
