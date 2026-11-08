"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

import type { DemoScene } from "@/components/marketing/demo-scenes";
import { HtmlFlyer } from "@/components/marketing/html-flyer";
import { Skeleton } from "@/components/ui/skeleton";
import { aspectRatio } from "@flyer/core/canvas/formats";
import { flyerVariants, pressScale, transitions } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

const STAGES = ["Composing layout…", "Selecting typography…", "Balancing colors…", "Finalizing."];

type Phase = "typing" | "generating" | "result";

const TYPE_MS = 34;
const STAGE_MS = 850;
const HOLD_MS = 3200;

export function HeroDemo({ scenes }: { scenes: DemoScene[] }) {
  const reduceMotion = usePrefersReducedMotion();
  const [scene, setScene] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [stage, setStage] = useState(0);
  const [selected, setSelected] = useState(0);

  const current = scenes[scene]!;
  const docs = current.docs;

  // The demo's clock: type → generate → reveal → hold → next prompt.
  useEffect(() => {
    if (reduceMotion) return;
    let timer: number;
    if (phase === "typing") {
      timer = typed < current.prompt.length
        ? window.setTimeout(() => setTyped((value) => value + 1), TYPE_MS)
        : window.setTimeout(() => setPhase("generating"), 450);
    } else if (phase === "generating") {
      timer = stage < STAGES.length - 1
        ? window.setTimeout(() => setStage((value) => value + 1), STAGE_MS)
        : window.setTimeout(() => setPhase("result"), STAGE_MS);
    } else {
      timer = window.setTimeout(() => {
        setScene((value) => (value + 1) % scenes.length);
        setTyped(0);
        setStage(0);
        setSelected(0);
        setPhase("typing");
      }, HOLD_MS);
    }
    return () => window.clearTimeout(timer);
  }, [phase, typed, stage, current, reduceMotion, scenes.length]);

  const showResult = reduceMotion || phase === "result";
  const prompt = reduceMotion ? current.prompt : current.prompt.slice(0, typed);

  return (
    <section className="flex w-full flex-col gap-4" aria-label="Product demo: a prompt becomes a flyer">
      <div className="flex items-end gap-3 rounded-panel bg-surface p-4 shadow-card">
        <p className="min-h-12 flex-1 text-left text-callout text-fg">
          {prompt}
          {!showResult && phase === "typing" && (
            <motion.span
              aria-hidden
              className="ml-1 inline-block h-5 w-px translate-y-1 bg-accent"
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
        </p>
        <motion.span
          aria-hidden
          animate={{ scale: phase === "generating" && stage === 0 ? pressScale : 1 }}
          transition={transitions.press}
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast",
            phase === "typing" && typed < current.prompt.length && "opacity-40",
          )}
        >
          <ArrowUp className="size-5" />
        </motion.span>
      </div>

      <div className="flex h-6 items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={showResult ? "done" : phase === "generating" ? stage : "idle"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: transitions.page }}
            exit={{ opacity: 0, y: -8, transition: transitions.fade }}
            className="text-callout font-medium text-fg-secondary"
          >
            {showResult ? "Three variations, fully editable." : phase === "generating" ? STAGES[stage] : " "}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="mx-auto w-full max-w-xs">
        <div className="relative" style={{ aspectRatio: aspectRatio("poster") }}>
          {phase === "generating" && !reduceMotion && <Skeleton className="absolute inset-0 rounded-control" />}
          <AnimatePresence>
            {showResult && (
              <motion.div
                key={`${scene}-${selected}`}
                variants={flyerVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="absolute inset-0 overflow-hidden rounded-control shadow-page"
              >
                <HtmlFlyer doc={docs[selected]!} className="size-full" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <motion.div
        animate={{ opacity: showResult ? 1 : 0 }}
        transition={transitions.fade}
        className="flex justify-center gap-3"
      >
        {docs.map((doc, index) => (
          <button
            key={index}
            type="button"
            tabIndex={showResult ? 0 : -1}
            aria-label={`Show variation ${index + 1}`}
            onClick={() => setSelected(index)}
            className={cn(
              "focus-ring w-14 overflow-hidden rounded-button shadow-card",
              index === selected ? "ring-2 ring-accent ring-offset-2 ring-offset-base" : "opacity-70 hover:opacity-100",
            )}
          >
            <HtmlFlyer doc={doc} />
          </button>
        ))}
      </motion.div>
    </section>
  );
}
