import { Sparkles } from "lucide-react";
import type { Metadata } from "next";

import { ProjectGrid } from "@/components/projects/project-grid";
import { PageHeader } from "@/components/shell/page-header";
import { ButtonLink } from "@/components/ui/button";
import { listProjects } from "@/lib/projects";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-6 py-8 md:px-10 md:py-12">
      <PageHeader
        title="Projects"
        description={projects.length > 0 ? `${projects.length} flyer${projects.length === 1 ? "" : "s"}` : undefined}
        actions={
          projects.length > 0 && (
            <ButtonLink href="/dashboard">
              <Sparkles />
              New flyer
            </ButtonLink>
          )
        }
      />
      {projects.length > 0 ? (
        <ProjectGrid projects={projects} />
      ) : (
        <section className="flex flex-col items-center gap-4 rounded-panel bg-surface px-6 py-8 text-center shadow-card">
          <p className="text-headline text-fg">Your flyers will live here</p>
          <p className="max-w-(--prose-max) text-callout text-fg-secondary">
            Describe an event, a sale or a listing and we&rsquo;ll lay out three designs you can edit and print.
          </p>
          <ButtonLink href="/dashboard" size="lg">
            <Sparkles />
            Create your first flyer
          </ButtonLink>
        </section>
      )}
    </div>
  );
}
