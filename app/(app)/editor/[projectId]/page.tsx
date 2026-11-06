import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EditorLoader } from "@/components/canvas/editor/editor-loader";
import { requireViewer } from "@/lib/auth/viewer";
import { flyerDocSchema } from "@/lib/canvas/schema";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editor" };

export default async function EditorPage({ params }: PageProps<"/editor/[projectId]">) {
  const { projectId } = await params;
  await requireViewer(`/editor/${projectId}`);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("flyer_projects")
    .select("id, title, canvas, updated_at, generation_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const parsed = flyerDocSchema.safeParse(project.canvas);
  if (!parsed.success) notFound();

  let artwork: string[] = [];
  if (project.generation_id) {
    const { data: job } = await supabase.from("generation_jobs").select("variations").eq("id", project.generation_id).maybeSingle();
    // generation_jobs.variations holds { photos: string[][] } — the stock photos each direction used.
    const photos = job?.variations && typeof job.variations === "object" && !Array.isArray(job.variations) ? job.variations.photos : null;
    if (Array.isArray(photos)) {
      artwork = [...new Set(photos.flat().filter((url): url is string => typeof url === "string"))];
    }
  }

  return (
    <EditorLoader id={project.id} title={project.title} doc={parsed.data} updatedAt={project.updated_at} artwork={artwork} />
  );
}
