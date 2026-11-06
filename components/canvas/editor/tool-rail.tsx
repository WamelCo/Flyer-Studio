"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Image as ImageIcon, Layers, Shapes, Type, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { sheetVariants, transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type Tool = "text" | "image" | "shape" | "layers";

export const TOOLS: { id: Tool; label: string; icon: LucideIcon; shortcut: string }[] = [
  { id: "text", label: "Text", icon: Type, shortcut: "T" },
  { id: "image", label: "Image", icon: ImageIcon, shortcut: "I" },
  { id: "shape", label: "Shape", icon: Shapes, shortcut: "S" },
  { id: "layers", label: "Layers", icon: Layers, shortcut: "L" },
];

/** Desktop: slim floating icon rail on the left. */
export function ToolRail({ active, onToggle }: { active: Tool | null; onToggle: (tool: Tool) => void }) {
  return (
    <nav
      aria-label="Tools"
      className="material fixed left-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-1 rounded-panel p-1 shadow-float md:flex"
    >
      {TOOLS.map(({ id, label, icon: Icon, shortcut }) => (
        <Tooltip key={id} content={label} shortcut={shortcut} side="right">
          <button
            type="button"
            aria-label={label}
            aria-pressed={active === id}
            onClick={() => onToggle(id)}
            className={cn(
              "focus-ring relative inline-flex size-11 items-center justify-center rounded-control",
              active === id ? "text-accent-text" : "text-fg hover:bg-fill",
            )}
          >
            {active === id && (
              <motion.span layoutId="rail-active" transition={transitions.layout} className="absolute inset-0 rounded-control bg-accent-soft" />
            )}
            <Icon className="relative size-5" />
          </button>
        </Tooltip>
      ))}
    </nav>
  );
}

/** Mobile: the rail becomes a bottom tab bar. */
export function ToolTabBar({ active, onToggle }: { active: Tool | null; onToggle: (tool: Tool) => void }) {
  return (
    <nav aria-label="Tools" className="material fixed inset-x-0 bottom-0 z-30 flex pb-[env(safe-area-inset-bottom)] md:hidden">
      {TOOLS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={active === id}
          onClick={() => onToggle(id)}
          className={cn(
            "focus-ring flex h-14 flex-1 flex-col items-center justify-center gap-1 text-caption font-medium",
            active === id ? "text-accent-text" : "text-fg-secondary",
          )}
        >
          <Icon className="size-5" />
          {label}
        </button>
      ))}
    </nav>
  );
}

/** Translucent floating panel (desktop: beside the rail; mobile: bottom sheet above the tab bar). */
export function ToolPanel({ tool, onClose, children }: { tool: Tool | null; onClose: () => void; children: ReactNode }) {
  const meta = TOOLS.find((candidate) => candidate.id === tool);
  return (
    <AnimatePresence>
      {tool && meta && (
        <motion.aside
          key={tool}
          aria-label={`${meta.label} panel`}
          variants={sheetVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className={cn(
            "material fixed z-30 flex flex-col gap-4 overflow-y-auto p-4 shadow-float",
            "inset-x-0 bottom-14 max-h-[50dvh] origin-bottom rounded-t-panel pb-[env(safe-area-inset-bottom)]",
            "md:inset-x-auto md:bottom-auto md:left-20 md:top-1/2 md:max-h-[70dvh] md:w-72 md:origin-left md:-translate-y-1/2 md:rounded-panel",
          )}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-headline text-fg">{meta.label}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="focus-ring inline-flex size-8 items-center justify-center rounded-full bg-fill text-fg-secondary hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>
          {children}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
