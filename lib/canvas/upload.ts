"use client";

import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export class UploadError extends Error {}

function naturalSize(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      reject(new UploadError("That file isn't a readable image."));
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

/** Uploads into the user's own storage folder (RLS-enforced) and returns a public URL. */
export async function uploadImage(file: File, userId: string) {
  const extension = TYPES[file.type];
  if (!extension) throw new UploadError("Use a PNG, JPEG or WebP image.");
  if (file.size > MAX_BYTES) throw new UploadError("Images must be 10 MB or smaller.");

  const size = await naturalSize(file);
  const supabase = createClient();
  const path = `${userId}/uploads/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("flyers").upload(path, file, { contentType: file.type, cacheControl: "31536000" });
  if (error) throw new UploadError("Upload failed. Check your connection and try again.");
  return { url: supabase.storage.from("flyers").getPublicUrl(path).data.publicUrl, ...size };
}
