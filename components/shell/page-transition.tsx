"use client";

import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

import { pageVariants } from "@/lib/motion";

/**
 * Set after the first page mounts in the browser. Effects never run on the server, so
 * server renders always see `false` and hydrate without a mismatch.
 */
let hasMounted = false;

/**
 * Fade + 8px rise, 300ms ease-out, on in-app navigation. Used by each route group's
 * template.tsx. The first page of a visit renders visible straight from the server:
 * hiding server HTML until hydration would delay first meaningful paint by seconds on
 * slower phones.
 */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const [animateIn] = useState(() => hasMounted);
  useEffect(() => {
    hasMounted = true;
  }, []);

  return (
    <motion.div variants={pageVariants} initial={animateIn ? "initial" : false} animate="animate" className={className}>
      {children}
    </motion.div>
  );
}
