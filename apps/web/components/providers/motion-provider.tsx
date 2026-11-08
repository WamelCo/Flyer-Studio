"use client";

import { MotionConfig, MotionGlobalConfig } from "framer-motion";
import { useEffect, type ReactNode } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// Evaluated before hydration so first-paint animations are already skipped.
if (typeof window !== "undefined") {
  MotionGlobalConfig.skipAnimations = window.matchMedia(QUERY).matches;
}

/**
 * With reduced motion every Framer Motion animation completes instantly — a state
 * change, not a shorter animation. CSS transitions are handled in globals.css.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const sync = () => {
      MotionGlobalConfig.skipAnimations = media.matches;
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
