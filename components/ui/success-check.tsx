"use client";

import { motion } from "framer-motion";

import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Circle scales in with a spring, then the tick draws itself. */
export function SuccessCheck({ className }: { className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 52 52"
      className={cn("size-12 text-success", className)}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={transitions.flyer}
      aria-hidden
    >
      <circle cx="26" cy="26" r="25" fill="currentColor" opacity="0.14" />
      <motion.path
        d="M15 27l7.5 7.5L37 19"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, ease: "easeOut", delay: 0.15 }}
      />
    </motion.svg>
  );
}
