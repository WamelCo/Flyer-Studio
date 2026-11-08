import type { UploadSlot } from "@flyer/core/api/contracts";
import { prisma } from "@flyer/db";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ApiException, parseJson, type AppEnv } from "../http";
import { presignPut, publicUrl } from "../r2";
import { requireUser } from "../session";

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

const Body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    contentType: z.string(),
    size: z.number().int().positive(),
  }),
  // A reference flyer whose style a new design should follow.
  z.object({
    kind: z.literal("reference"),
    contentType: z.string(),
    size: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("thumbnail"),
    contentType: z.literal("image/webp"),
    size: z.number().int().positive().max(MAX_THUMBNAIL_BYTES),
    projectId: z.string().uuid(),
  }),
]);

/**
 * Issues a presigned PUT into the caller's own folder of the public bucket. The key is
 * chosen here (never by the client) and the signed Content-Length pins the file size.
 */
export const uploads = new Hono<AppEnv>().use(requireUser).post("/", async (c) => {
  const user = c.var.user;
  const body = await parseJson(c, Body);

  let key: string;
  if (body.kind === "image" || body.kind === "reference") {
    const extension = IMAGE_TYPES[body.contentType];
    if (!extension) throw new ApiException("VALIDATION_ERROR", "Use a PNG, JPEG or WebP image.");
    if (body.size > MAX_IMAGE_BYTES) throw new ApiException("VALIDATION_ERROR", "Images must be 10 MB or smaller.");
    key = `${user.id}/${body.kind === "reference" ? "references" : "uploads"}/${randomUUID()}.${extension}`;
  } else {
    const project = await prisma.flyerProject.findFirst({ where: { id: body.projectId, userId: user.id }, select: { id: true } });
    if (!project) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");
    key = `${user.id}/thumbs/${body.projectId}.webp`;
  }

  const slot = await presignPut({ bucket: "public", key, contentType: body.contentType, contentLength: body.size });
  const response: UploadSlot = { uploadUrl: slot.url, uploadHeaders: slot.headers, publicUrl: publicUrl(key) };
  return c.json(response);
});
