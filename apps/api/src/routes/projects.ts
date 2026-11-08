import type { ProjectDetail, ProjectSummary, SaveProjectResponse } from "@flyer/core/api/contracts";
import { flyerDocSchema } from "@flyer/core/canvas/schema";
import type { FlyerFormat } from "@flyer/core/canvas/types";
import { Prisma, prisma } from "@flyer/db";
import { Hono } from "hono";
import { z } from "zod";

import { ApiException, parseJson, uuidParam, type AppEnv } from "../http";
import { publicUrlPrefix } from "../r2";
import { requireUser } from "../session";

const NOT_FOUND = "This project doesn't exist or isn't yours.";

const Patch = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    canvas: flyerDocSchema.optional(),
    thumbnailUrl: z.string().url().max(2048).nullable().optional(),
  })
  .refine((body) => body.title !== undefined || body.canvas !== undefined || body.thumbnailUrl !== undefined, {
    message: "Nothing to update",
  });

/**
 * Images must come from our own R2 bucket or Unsplash (hotlinked per its guidelines):
 * both serve CORS headers, so exports never taint the canvas. "" is an empty photo slot.
 */
function assertOwnedAssets(urls: string[]) {
  if (urls.length === 0) return;
  const storage = publicUrlPrefix();
  const allowed = (url: string) => !url || url.startsWith(storage) || url.startsWith("https://images.unsplash.com/");
  if (!urls.every(allowed)) throw new ApiException("VALIDATION_ERROR", "Images must be uploaded to Flyer Studio.");
}

/** Prisma's "record to update/delete not found". */
function isMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/** generation_jobs.variations holds { photos: string[][] } — the stock photos each direction used. */
function artworkFrom(variations: Prisma.JsonValue | undefined) {
  const photos =
    variations && typeof variations === "object" && !Array.isArray(variations) ? (variations as { photos?: unknown }).photos : null;
  if (!Array.isArray(photos)) return [];
  return [...new Set(photos.flat().filter((url): url is string => typeof url === "string"))];
}

export const projects = new Hono<AppEnv>()
  .use(requireUser)

  /** The caller's projects, newest first. */
  .get("/", async (c) => {
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 60));
    const rows = await prisma.flyerProject.findMany({
      where: { userId: c.var.user.id },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, title: true, format: true, thumbnailUrl: true, updatedAt: true },
    });
    const projects: ProjectSummary[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      format: row.format as FlyerFormat,
      thumbnailUrl: row.thumbnailUrl,
      updatedAt: row.updatedAt.toISOString(),
    }));
    return c.json({ projects });
  })

  .get("/:id", async (c) => {
    const id = uuidParam(c.req.param("id"), NOT_FOUND);
    const project = await prisma.flyerProject.findFirst({
      where: { id, userId: c.var.user.id },
      select: {
        id: true,
        title: true,
        format: true,
        canvas: true,
        thumbnailUrl: true,
        updatedAt: true,
        generationId: true,
        generation: { select: { variations: true } },
      },
    });
    if (!project) throw new ApiException("NOT_FOUND", NOT_FOUND);

    const detail: ProjectDetail = {
      id: project.id,
      title: project.title,
      format: project.format as FlyerFormat,
      canvas: project.canvas,
      thumbnail_url: project.thumbnailUrl,
      updated_at: project.updatedAt.toISOString(),
      generation_id: project.generationId,
      artwork: artworkFrom(project.generation?.variations),
    };
    return c.json(detail);
  })

  .patch("/:id", async (c) => {
    const id = uuidParam(c.req.param("id"), NOT_FOUND);
    const body = await parseJson(c, Patch);

    assertOwnedAssets([
      ...(body.canvas?.nodes.flatMap((node) => (node.type === "image" ? [node.src] : [])) ?? []),
      ...(body.thumbnailUrl ? [body.thumbnailUrl.split("?")[0]!] : []),
    ]);

    try {
      const saved = await prisma.flyerProject.update({
        where: { id, userId: c.var.user.id },
        data: {
          ...(body.title !== undefined && { title: body.title }),
          ...(body.canvas !== undefined && {
            canvas: JSON.parse(JSON.stringify(body.canvas)) as Prisma.InputJsonValue,
            format: body.canvas.format,
            revision: { increment: 1 },
          }),
          ...(body.thumbnailUrl !== undefined && { thumbnailUrl: body.thumbnailUrl }),
        },
        select: { revision: true, updatedAt: true },
      });
      const response: SaveProjectResponse = { revision: saved.revision, updatedAt: saved.updatedAt.toISOString() };
      return c.json(response);
    } catch (error) {
      if (isMissing(error)) throw new ApiException("NOT_FOUND", NOT_FOUND);
      throw error;
    }
  })

  .delete("/:id", async (c) => {
    const id = uuidParam(c.req.param("id"), NOT_FOUND);
    const { count } = await prisma.flyerProject.deleteMany({ where: { id, userId: c.var.user.id } });
    if (count === 0) throw new ApiException("NOT_FOUND", NOT_FOUND);
    return c.json({ deleted: true });
  });
