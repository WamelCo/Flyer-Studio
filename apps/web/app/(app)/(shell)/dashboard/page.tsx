import type { Metadata } from "next";

import { CreateView } from "@/components/create/create-view";
import { listProjects } from "@/lib/projects";

export const metadata: Metadata = { title: "Create" };

export default async function DashboardPage() {
  const recentProjects = await listProjects(8);
  return <CreateView recentProjects={recentProjects} />;
}
