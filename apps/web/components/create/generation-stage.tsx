"use client";

import { motion } from "framer-motion";
import type Konva from "konva";
import dynamic from "next/dynamic";
import { useCallback, useState, type ReactNode } from "react";

import { StagedStatus } from "@/components/create/staged-status";
import { Skeleton } from "@/components/ui/skeleton";
import type { GenerateResponse } from "@flyer/core/api/contracts";
import { FORMATS } from "@flyer/core/canvas/formats";
import type { FlyerFormat } from "@flyer/core/canvas/types";
import { flyerVariants, transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

const FlyerPreview = dynamic(() => import("@/components/canvas/flyer-preview"), { ssr: false });

/** Width that keeps the page within the viewport height for its aspect ratio. */
function frameStyle(format: FlyerFormat, maxHeight: string) {
  const { width, height } = FORMATS[format];
  return { aspectRatio: `${width} / ${height}`, width: `min(100%, calc(${maxHeight} * ${width / height}))` };
}

export function GeneratingFrame({ format }: { format: FlyerFormat }) {
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <StagedStatus />
      <div style={frameStyle(format, "62dvh")}>
        <Skeleton className="size-full rounded-control" />
      </div>
    </div>
  );
}

interface ResultFrameProps {
  result: GenerateResponse;
  selected: number;
  onSelect: (index: number) => void;
  onMainReady: (page: Konva.Group, index: number) => void;
  actions: ReactNode;
}

export function ResultFrame({ result, selected, onSelect, onMainReady, actions }: ResultFrameProps) {
  const { docs, directions } = result;
  // The skeleton and staged text stay until fonts and artwork are in, then the flyer springs in.
  const [revealed, setRevealed] = useState(false);
  const handleReady = useCallback(
    (page: Konva.Group) => {
      setRevealed(true);
      onMainReady(page, selected);
    },
    [onMainReady, selected],
  );

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {revealed ? (
        <div className="flex h-6 items-center text-callout font-medium text-fg-secondary">Here&rsquo;s your flyer.</div>
      ) : (
        <StagedStatus />
      )}

      <div className="relative" style={frameStyle(result.format, "62dvh")}>
        {!revealed && <Skeleton className="absolute inset-0 rounded-control" />}
        <motion.div
          variants={flyerVariants}
          initial="initial"
          animate={revealed ? "animate" : "initial"}
          className="overflow-hidden rounded-control shadow-page"
        >
          <FlyerPreview key={selected} doc={docs[selected]!} onReady={handleReady} />
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        transition={{ ...transitions.page, delay: revealed ? 0.12 : 0 }}
        className="flex w-full flex-col items-center gap-6"
      >
        <div role="radiogroup" aria-label="Design directions" className="flex items-start justify-center gap-4">
          {docs.map((doc, index) => {
            const direction = directions[index];
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={index === selected}
                aria-label={direction ? `${direction.layout}, ${direction.palette}, ${direction.type}` : `Direction ${index + 1}`}
                onClick={() => onSelect(index)}
                className="focus-ring group flex w-24 flex-col items-center gap-2 rounded-button sm:w-28"
              >
                <span
                  className={cn(
                    "block w-full overflow-hidden rounded-button bg-surface shadow-card",
                    index === selected ? "ring-2 ring-accent ring-offset-2 ring-offset-base" : "opacity-80 group-hover:opacity-100",
                  )}
                >
                  <FlyerPreview doc={doc} />
                </span>
                {direction && (
                  <span className={cn("text-center text-caption", index === selected ? "text-fg" : "text-fg-secondary")}>{direction.palette}</span>
                )}
              </button>
            );
          })}
        </div>
        {result.rationale && <p className="max-w-(--prose-max) text-center text-callout text-fg-secondary">{result.rationale}</p>}
        {actions}
      </motion.div>
    </div>
  );
}
