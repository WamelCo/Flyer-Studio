import { sniffImage } from "@flyer/storage";

import { ApiException } from "@/lib/api/server";

export const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/**
 * Reads a raw upload body (at most `maxBytes`) and checks it really is a PNG, JPEG or WebP
 * by its bytes — the declared type is never trusted on its own.
 */
export async function readImageUpload(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new ApiException("VALIDATION_ERROR", `Images must be ${Math.round(maxBytes / 1_048_576)} MB or smaller.`);
  const bytes = await readBody(request, maxBytes);
  const type = sniffImage(bytes);
  if (!type) throw new ApiException("VALIDATION_ERROR", "Use a PNG, JPEG or WebP image.");
  return { bytes, type, extension: EXTENSIONS[type] };
}

/** The request body, refusing anything larger than `maxBytes` without buffering it all. */
export async function readBody(request: Request, maxBytes: number) {
  if (!request.body) throw new ApiException("VALIDATION_ERROR", "The upload was empty.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiException("VALIDATION_ERROR", `The file is over the ${Math.round(maxBytes / 1_048_576)} MB limit.`);
    }
    chunks.push(value);
  }
  if (!size) throw new ApiException("VALIDATION_ERROR", "The upload was empty.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
