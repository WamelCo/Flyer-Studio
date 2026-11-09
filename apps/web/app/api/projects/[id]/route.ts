import { NextResponse } from "next/server";
import { z } from "zod";

import type { SaveProjectResponse } from "@/lib/api/contracts";
import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { flyerDocSchema } from "@flyer/design/canvas/schema";
import { and, db, eq, flyerProjects, sql } from "@flyer/db";
import { keyFromPublicUrl } from "@flyer/storage";

import { findProject } from "@/lib/projects";

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
 * Images must come from our own storage or Unsplash (hotlinked per its guidelines):
 * both serve CORS headers, so exports never taint the canvas. "" is an empty photo slot.
 */
function assertOwnedAssets(urls: string[]) {
  const allowed = (url: string) => !url || keyFromPublicUrl(url) !== null || url.startsWith("https://images.unsplash.com/");
  if (!urls.every(allowed)) {
    throw new ApiException("VALIDATION_ERROR", "Images must be uploaded to Flyer Studio.");
  }
}

export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]">) => {
  const user = await requireUser();
  const { id } = await params;
  const project = await findProject(user.id, id);
  if (!project) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");
  const { id: projectId, title, format, canvas, thumbnailUrl, updatedAt } = project;
  return NextResponse.json({ id: projectId, title, format, canvas, thumbnail_url: thumbnailUrl, updated_at: updatedAt.toISOString() });
});

export const PATCH = handle(async (request: Request, { params }: RouteContext<"/api/projects/[id]">) => {
  const user = await requireUser();
  const { id } = await params;
  const body = await parseJson(request, Patch);

  const assets = [
    ...(body.canvas?.nodes.flatMap((node) => (node.type === "image" ? [node.src] : [])) ?? []),
    ...(body.thumbnailUrl ? [body.thumbnailUrl.split("?")[0]!] : []),
  ];
  assertOwnedAssets(assets);

  const [data] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db()
        .update(flyerProjects)
        .set({
          ...(body.title !== undefined && { title: body.title }),
          ...(body.canvas !== undefined && { canvas: JSON.parse(JSON.stringify(body.canvas)), format: body.canvas.format }),
          ...(body.thumbnailUrl !== undefined && { thumbnailUrl: body.thumbnailUrl }),
          revision: sql`${flyerProjects.revision} + 1`,
        })
        .where(and(eq(flyerProjects.id, id), eq(flyerProjects.userId, user.id)))
        .returning({ revision: flyerProjects.revision, updatedAt: flyerProjects.updatedAt })
    : [];
  if (!data) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");

  const response: SaveProjectResponse = { revision: data.revision, updatedAt: data.updatedAt.toISOString() };
  return NextResponse.json(response);
});

export const DELETE = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]">) => {
  const user = await requireUser();
  const { id } = await params;
  const [data] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db().delete(flyerProjects).where(and(eq(flyerProjects.id, id), eq(flyerProjects.userId, user.id))).returning({ id: flyerProjects.id })
    : [];
  if (!data) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");
  return NextResponse.json({ deleted: true });
});
