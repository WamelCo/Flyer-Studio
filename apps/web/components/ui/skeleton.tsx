"use client";

import { motion } from "framer-motion";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/** Placeholder with a soft travelling highlight. Never a spinner. */
export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden bg-skeleton", className)} style={style}>
      <motion.div
        className="absolute inset-y-0 w-1/2"
        style={{
          background: "linear-gradient(90deg, transparent, var(--skeleton-highlight), transparent)",
        }}
        initial={{ x: "-100%" }}
        animate={{ x: "300%" }}
        transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.2 }}
      />
    </div>
  );
}
