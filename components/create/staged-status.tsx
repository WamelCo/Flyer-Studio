"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { transitions } from "@/lib/motion";

/**
 * What the user reads while a flyer is designed. With a background job the server
 * reports its real stage (lib/generation/pipeline.ts); within a long stage — the lead
 * design can take ~30–60 s — the stage's own sentences advance, then rest on the last.
 */
const BY_STAGE: Record<string, string[]> = {
  queued: ["Getting started…"],
  directing: ["Reading your brief…", "Choosing colours and type…", "Writing the copy…"],
  designing: ["Finding photography…", "Designing the lead direction…", "Refining the artwork…", "Setting the type on the artwork…", "Almost there…"],
  composing: ["Composing three directions…"],
  reviewing: ["Reviewing the designs…", "Refining the weakest direction…", "Choosing the strongest…"],
  saving: ["Saving your designs…"],
  done: ["Ready."],
};

// Without a server stage (in-request mode), walk the whole pipeline on a timer.
export const GENERATION_STAGES = [
  ...BY_STAGE.directing!,
  ...BY_STAGE.designing!.slice(0, 2),
  "Setting the type…",
  ...BY_STAGE.composing!,
  "Adding the final touches…",
  "Almost there…",
];
const STEP_MS = 3500;

export function StagedStatus({ stage }: { stage?: string }) {
  const messages = (stage && BY_STAGE[stage]) || GENERATION_STAGES;
  const [progress, setProgress] = useState({ stage, index: 0 });
  // A new server stage starts its own sentences from the top.
  const index = progress.stage === stage ? progress.index : 0;

  useEffect(() => {
    if (index >= messages.length - 1) return;
    const timer = window.setTimeout(() => setProgress({ stage, index: index + 1 }), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [index, messages.length, stage]);

  const text = messages[Math.min(index, messages.length - 1)]!;
  return (
    <div className="relative flex h-6 items-center justify-center overflow-hidden" role="status" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: transitions.page }}
          exit={{ opacity: 0, y: -8, transition: transitions.fade }}
          className="text-callout font-medium text-fg-secondary"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
