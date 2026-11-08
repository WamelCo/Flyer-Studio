"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

import type { ProjectSummary } from "@flyer/core/api/contracts";
import { FORMATS } from "@flyer/core/canvas/formats";
import { cardLift, cardShadow } from "@/lib/motion";
import { formatRelativeTime } from "@/lib/utils";

const MotionLink = motion.create(Link);

function ProjectCard({ project, priority }: { project: ProjectSummary; priority: boolean }) {
  const format = FORMATS[project.format];
  return (
    <MotionLink
      href={`/editor/${project.id}`}
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileFocus="hover"
      variants={cardLift}
      className="focus-ring group relative flex flex-col gap-3 rounded-panel bg-surface p-3 shadow-card"
    >
      {/* Pre-rendered hover shadow; only its opacity animates. */}
      <motion.span aria-hidden variants={cardShadow} className="pointer-events-none absolute inset-0 rounded-panel shadow-hover" />
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-control bg-base">
        {project.thumbnailUrl ? (
          <Image
            src={project.thumbnailUrl}
            alt=""
            width={format.width}
            height={format.height}
            sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
            priority={priority}
            className="h-full w-auto max-w-full object-contain shadow-card"
            style={{ aspectRatio: `${format.width} / ${format.height}` }}
          />
        ) : (
          <span className="text-caption text-fg-secondary">{format.label}</span>
        )}
      </div>
      <div className="relative flex flex-col gap-1 px-1 pb-1">
        <span className="truncate text-callout font-medium text-fg">{project.title}</span>
        <span className="text-caption text-fg-secondary">
          {format.label} · {formatRelativeTime(project.updatedAt)}
        </span>
      </div>
    </MotionLink>
  );
}

export function ProjectGrid({ projects }: { projects: ProjectSummary[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {projects.map((project, index) => (
        <ProjectCard key={project.id} project={project} priority={index < 4} />
      ))}
    </div>
  );
}
