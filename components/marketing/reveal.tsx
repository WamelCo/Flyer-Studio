"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Content that rises into place the first time it scrolls into view — the product-page
 * cadence. Below the fold only (the hero renders visible from the server for LCP).
 * Reduced motion: MotionConfig drops the movement, leaving a quick fade.
 */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
