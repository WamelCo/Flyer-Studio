import { db, eq, flyerProjects } from "@flyer/db";
import { putObject } from "@flyer/storage";
import { NextResponse } from "next/server";

import { ApiException, handle, requireUser } from "@/lib/api/server";
import { findProject } from "@/lib/projects";
import { enforce, LIMITS } from "@/lib/rate-limit";
import { readImageUpload } from "@/lib/uploads";

export const runtime = "nodejs";

/** The project's grid thumbnail (body: a small WebP rendered by the editor). */
export const POST = handle(async (request: Request, { params }: RouteContext<"/api/projects/[id]/thumbnail">) => {
  const user = await requireUser();
  const { id } = await params;
  await enforce(LIMITS.upload(user.id), "Saving very quickly — wait a moment and try again.");
  const project = await findProject(user.id, id);
  if (!project) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");
  const { bytes, type, extension } = await readImageUpload(request, 2 * 1024 * 1024);
  const stored = await putObject("public", `${user.id}/thumbs/${project.id}.${extension}`, bytes, { contentType: type, cacheControl: "public, max-age=60" });
  // A version query busts caches when the same key is overwritten.
  const url = `${stored}?v=${Date.now()}`;
  await db().update(flyerProjects).set({ thumbnailUrl: url }).where(eq(flyerProjects.id, project.id));
  return NextResponse.json({ url });
});
