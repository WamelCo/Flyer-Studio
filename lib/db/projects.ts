import type { ProjectSummary } from "@/lib/api/contracts";
import type { FlyerFormat } from "@/lib/canvas/types";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's projects, newest first (RLS scopes the query). */
export async function listProjects(limit = 60): Promise<ProjectSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flyer_projects")
    .select("id, title, format, thumbnail_url, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`projects query failed: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    format: row.format as FlyerFormat,
    thumbnailUrl: row.thumbnail_url,
    updatedAt: row.updated_at,
  }));
}
