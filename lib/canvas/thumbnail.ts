"use client";

import type Konva from "konva";

import { apiFetch } from "@/lib/api/client";
import { renderPage } from "@/lib/canvas/render";
import type { FlyerDoc } from "@/lib/canvas/types";
import { createClient } from "@/lib/supabase/client";

const THUMBNAIL_WIDTH = 480;

/** Renders a small WebP of the page and stores it as the project's grid thumbnail. */
export async function saveThumbnail(page: Konva.Group, doc: FlyerDoc, { userId, projectId }: { userId: string; projectId: string }) {
  const blob = await renderPage(page, doc, { width: THUMBNAIL_WIDTH, mimeType: "image/webp", quality: 0.85 });
  const supabase = createClient();
  const path = `${userId}/thumbs/${projectId}.webp`;
  const { error } = await supabase.storage.from("flyers").upload(path, blob, { contentType: "image/webp", upsert: true });
  if (error) throw error;
  const url = `${supabase.storage.from("flyers").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  await apiFetch(`/api/projects/${projectId}`, { method: "PATCH", json: { thumbnailUrl: url } });
  return url;
}
