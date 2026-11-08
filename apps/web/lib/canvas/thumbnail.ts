"use client";

import type Konva from "konva";

import { apiFetch } from "@/lib/api/client";
import { renderPage } from "@/lib/canvas/render";
import type { FlyerDoc } from "@flyer/core/canvas/types";
import { uploadPublic } from "@/lib/storage";

const THUMBNAIL_WIDTH = 480;

/** Renders a small WebP of the page and stores it as the project's grid thumbnail. */
export async function saveThumbnail(page: Konva.Group, doc: FlyerDoc, { projectId }: { projectId: string }) {
  const blob = await renderPage(page, doc, { width: THUMBNAIL_WIDTH, mimeType: "image/webp", quality: 0.85 });
  const url = `${await uploadPublic(blob, { kind: "thumbnail", contentType: "image/webp", projectId })}?v=${Date.now()}`;
  await apiFetch(`/api/projects/${projectId}`, { method: "PATCH", json: { thumbnailUrl: url } });
  return url;
}
