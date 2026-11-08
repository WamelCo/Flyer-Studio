import type { ProjectSummary } from "@flyer/core/api/contracts";

import { serverApi } from "@/lib/api/server";

/** The signed-in user's projects, newest first. */
export async function listProjects(limit = 60): Promise<ProjectSummary[]> {
  const { projects } = await serverApi<{ projects: ProjectSummary[] }>(`/api/projects?limit=${limit}`);
  return projects;
}
