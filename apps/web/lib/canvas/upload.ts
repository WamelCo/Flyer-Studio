"use client";

import { ApiError } from "@/lib/api/client";
import { uploadPublic } from "@/lib/storage";

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

/** Uploads into the user's own folder of the public R2 bucket and returns its URL. */
export async function uploadImage(file: File) {
  const extension = TYPES[file.type];
  if (!extension) throw new UploadError("Use a PNG, JPEG or WebP image.");
  if (file.size > MAX_BYTES) throw new UploadError("Images must be 10 MB or smaller.");

  const size = await naturalSize(file);
  try {
    const url = await uploadPublic(file, { kind: "image", contentType: file.type });
    return { url, ...size };
  } catch (error) {
    if (error instanceof ApiError && error.code === "VALIDATION_ERROR") throw new UploadError(error.message);
    throw new UploadError("Upload failed. Check your connection and try again.");
  }
}
