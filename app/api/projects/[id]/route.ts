import { NextResponse } from "next/server";
import { z } from "zod";

import type { SaveProjectResponse } from "@/lib/api/contracts";
import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { flyerDocSchema } from "@/lib/canvas/schema";
import { createClient } from "@/lib/supabase/server";

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
  const storage = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/flyers/`;
  const allowed = (url: string) => !url || url.startsWith(storage) || url.startsWith("https://images.unsplash.com/");
  if (!urls.every(allowed)) {
    throw new ApiException("VALIDATION_ERROR", "Images must be uploaded to Flyer Studio.");
  }
}

export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]">) => {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("flyer_projects")
    .select("id, title, format, canvas, thumbnail_url, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");
  return NextResponse.json(data);
});

export const PATCH = handle(async (request: Request, { params }: RouteContext<"/api/projects/[id]">) => {
  await requireUser();
  const { id } = await params;
  const body = await parseJson(request, Patch);

  const assets = [
    ...(body.canvas?.nodes.flatMap((node) => (node.type === "image" ? [node.src] : [])) ?? []),
    ...(body.thumbnailUrl ? [body.thumbnailUrl.split("?")[0]!] : []),
  ];
  assertOwnedAssets(assets);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flyer_projects")
    .update({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.canvas !== undefined && { canvas: JSON.parse(JSON.stringify(body.canvas)), format: body.canvas.format }),
      ...(body.thumbnailUrl !== undefined && { thumbnail_url: body.thumbnailUrl }),
    })
    .eq("id", id)
    .select("revision, updated_at")
    .maybeSingle();

  if (error) throw new Error(`project update failed: ${error.message}`);
  if (!data) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");

  const response: SaveProjectResponse = { revision: data.revision, updatedAt: data.updated_at };
  return NextResponse.json(response);
});

export const DELETE = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]">) => {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("flyer_projects").delete().eq("id", id).select("id").maybeSingle();
  if (error) throw new Error(`project delete failed: ${error.message}`);
  if (!data) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");
  return NextResponse.json({ deleted: true });
});
