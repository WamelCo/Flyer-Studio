"use client";

import type { UploadKind, UploadSlot } from "@flyer/core/api/contracts";

import { apiFetch } from "@/lib/api/client";

/** PUTs a file to a presigned R2 URL. Resolves true when R2 accepted it. */
export async function putToSlot(url: string, headers: Record<string, string>, body: Blob) {
  try {
    const response = await fetch(url, { method: "PUT", headers, body });
    return response.ok;
  } catch {
    return false;
  }
}

/** Asks the API for a slot in the public bucket, uploads, and returns the public URL. */
export async function uploadPublic(body: Blob, options: { kind: UploadKind; contentType: string; projectId?: string }) {
  const slot = await apiFetch<UploadSlot>("/api/uploads", {
    method: "POST",
    json: { kind: options.kind, contentType: options.contentType, size: body.size, projectId: options.projectId },
  });
  if (!(await putToSlot(slot.uploadUrl, slot.uploadHeaders, body))) throw new Error("UPLOAD_FAILED");
  return slot.publicUrl;
}
