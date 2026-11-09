import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EditorLoader } from "@/components/canvas/editor/editor-loader";
import { requireViewer } from "@/lib/auth/viewer";
import { flyerDocSchema } from "@flyer/design/canvas/schema";
import { and, db, eq, generationJobs } from "@flyer/db";

import { findProject } from "@/lib/projects";

export const metadata: Metadata = { title: "Editor" };

export default async function EditorPage({ params }: PageProps<"/editor/[projectId]">) {
  const { projectId } = await params;
  const viewer = await requireViewer(`/editor/${projectId}`);
  const project = await findProject(viewer.id, projectId);
  if (!project) notFound();

  const parsed = flyerDocSchema.safeParse(project.canvas);
  if (!parsed.success) notFound();

  let artwork: string[] = [];
  if (project.generationId) {
    const [job] = await db()
      .select({ variations: generationJobs.variations })
      .from(generationJobs)
      .where(and(eq(generationJobs.id, project.generationId), eq(generationJobs.userId, viewer.id)))
      .limit(1);
    // generation_jobs.variations holds { photos: string[][] } — the stock photos each direction used.
    const photos = job?.variations && typeof job.variations === "object" && !Array.isArray(job.variations) ? (job.variations as { photos?: unknown }).photos : null;
    if (Array.isArray(photos)) {
      artwork = [...new Set(photos.flat().filter((url): url is string => typeof url === "string"))];
    }
  }

  return (
    <EditorLoader id={project.id} title={project.title} doc={parsed.data} updatedAt={project.updatedAt.toISOString()} artwork={artwork} />
  );
}
