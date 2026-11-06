"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { transitions } from "@/lib/motion";

export const GENERATION_STAGES = ["Composing layout…", "Selecting typography…", "Balancing colors…", "Finalizing."];
const STAGE_MS = 2500;

/** Progressive disclosure while generating: advances every 2.5s and rests on the last stage. */
export function StagedStatus() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (stage >= GENERATION_STAGES.length - 1) return;
    const timer = window.setTimeout(() => setStage((value) => value + 1), STAGE_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  return (
    <div className="relative flex h-6 items-center justify-center overflow-hidden" role="status" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={stage}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: transitions.page }}
          exit={{ opacity: 0, y: -8, transition: transitions.fade }}
          className="text-callout font-medium text-fg-secondary"
        >
          {GENERATION_STAGES[stage]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
