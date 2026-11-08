import type { ProjectDetail } from "@flyer/core/api/contracts";
import { flyerDocSchema } from "@flyer/core/canvas/schema";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EditorLoader } from "@/components/canvas/editor/editor-loader";
import { ApiError } from "@/lib/api/client";
import { serverApi } from "@/lib/api/server";
import { requireViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Editor" };

export default async function EditorPage({ params }: PageProps<"/editor/[projectId]">) {
  const { projectId } = await params;
  await requireViewer(`/editor/${projectId}`);

  const project = await serverApi<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
    throw error;
  });
  if (!project) notFound();

  const parsed = flyerDocSchema.safeParse(project.canvas);
  if (!parsed.success) notFound();

  return (
    <EditorLoader
      id={project.id}
      title={project.title}
      doc={parsed.data}
      updatedAt={project.updated_at}
      artwork={project.artwork}
    />
  );
}
