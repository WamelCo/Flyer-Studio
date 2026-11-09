import { and, db, desc, eq, flyerProjects } from "@flyer/db";
import type { FlyerFormat } from "@flyer/design/canvas/types";

import type { ProjectSummary } from "@/lib/api/contracts";
import { requireViewer } from "@/lib/auth/viewer";

/** The signed-in user's projects, newest first. */
export async function listProjects(limit = 60): Promise<ProjectSummary[]> {
  const viewer = await requireViewer();
  const rows = await db()
    .select({ id: flyerProjects.id, title: flyerProjects.title, format: flyerProjects.format, thumbnailUrl: flyerProjects.thumbnailUrl, updatedAt: flyerProjects.updatedAt })
    .from(flyerProjects)
    .where(eq(flyerProjects.userId, viewer.id))
    .orderBy(desc(flyerProjects.updatedAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, format: row.format as FlyerFormat, updatedAt: row.updatedAt.toISOString() }));
}

/** One of the user's projects, or null when it doesn't exist or isn't theirs. */
export async function findProject(userId: string, projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const [row] = await db()
    .select()
    .from(flyerProjects)
    .where(and(eq(flyerProjects.id, projectId), eq(flyerProjects.userId, userId)))
    .limit(1);
  return row ?? null;
}
