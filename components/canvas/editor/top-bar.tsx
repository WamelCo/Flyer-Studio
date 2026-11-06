"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Minus, Plus, Redo2, Undo2 } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import type { SaveStatus } from "@/components/canvas/editor/use-autosave";
import type { Viewport } from "@/components/canvas/editor/viewport";
import { Tooltip } from "@/components/ui/tooltip";
import { fadeVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

function BarButton({
  label,
  shortcut,
  onClick,
  disabled,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} shortcut={shortcut} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="focus-ring inline-flex size-8 items-center justify-center rounded-button text-fg hover:bg-fill disabled:text-fg-secondary disabled:opacity-50"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function ZoomControl({ viewport, onZoom, onFit }: { viewport: Viewport; onZoom: (factor: number) => void; onFit: () => void }) {
  const scale = useSyncExternalStore(viewport.subscribe, () => viewport.get().scale, () => 1);
  return (
    <div className="flex items-center" role="group" aria-label="Zoom">
      <BarButton label="Zoom out" shortcut="⌘−" onClick={() => onZoom(1 / 1.25)}>
        <Minus className="size-4" />
      </BarButton>
      <Tooltip content="Fit to screen" shortcut="⌘0" side="bottom">
        <button
          type="button"
          onClick={onFit}
          aria-label={`Zoom ${Math.round(scale * 100)}%. Fit to screen`}
          className="focus-ring h-8 w-14 rounded-button text-callout tabular-nums text-fg hover:bg-fill"
        >
          {Math.round(scale * 100)}%
        </button>
      </Tooltip>
      <BarButton label="Zoom in" shortcut="⌘+" onClick={() => onZoom(1.25)}>
        <Plus className="size-4" />
      </BarButton>
    </div>
  );
}

/** "Saved" fades in after each save and fades out again. Never a modal. */
function SaveIndicator({ status }: { status: SaveStatus }) {
  const label =
    status === "saving" ? (
      "Saving…"
    ) : status === "saved" ? (
      "Saved"
    ) : status === "error" ? (
      <>
        <span className="sm:hidden">Retrying…</span>
        <span className="hidden sm:inline">Couldn&rsquo;t save — retrying</span>
      </>
    ) : null;
  return (
    <div className="w-16 text-right sm:w-36" role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        {label && (
          <motion.span
            key={status}
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={cn("text-caption", status === "error" ? "text-danger" : "text-fg-secondary")}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

interface TopBarProps {
  title: string;
  onRename: (title: string) => void;
  onBack: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  viewport: Viewport;
  onZoom: (factor: number) => void;
  onFit: () => void;
  saveStatus: SaveStatus;
  exportSlot: ReactNode;
}

export function TopBar({
  title,
  onRename,
  onBack,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  viewport,
  onZoom,
  onFit,
  saveStatus,
  exportSlot,
}: TopBarProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <header className="material fixed inset-x-0 top-0 z-30 flex h-(--bar-height) items-center gap-2 px-2 sm:px-3">
      <BarButton label="Back to projects" onClick={onBack}>
        <ChevronLeft className="size-5" />
      </BarButton>
      <input
        aria-label="Flyer title"
        value={draft ?? title}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setDraft(title)}
        onBlur={() => {
          const next = draft?.trim();
          if (next && next !== title) onRename(next.slice(0, 120));
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        className="focus-ring h-8 min-w-0 max-w-64 flex-1 truncate rounded-button bg-transparent px-2 text-headline text-fg hover:bg-fill"
      />

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <SaveIndicator status={saveStatus} />
        <div className="flex items-center">
          <BarButton label="Undo" shortcut="⌘Z" onClick={onUndo} disabled={!canUndo}>
            <Undo2 className="size-4" />
          </BarButton>
          <BarButton label="Redo" shortcut="⇧⌘Z" onClick={onRedo} disabled={!canRedo}>
            <Redo2 className="size-4" />
          </BarButton>
        </div>
        <div className="hidden md:block">
          <ZoomControl viewport={viewport} onZoom={onZoom} onFit={onFit} />
        </div>
        <div className="hidden md:block">{exportSlot}</div>
      </div>
    </header>
  );
}
