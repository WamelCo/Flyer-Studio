import type { Transition, Variants } from "framer-motion";

/**
 * The interaction spec, as code. Components import from here instead of inventing
 * timings; reduced motion is handled globally in MotionProvider.
 */
export const transitions = {
  page: { duration: 0.3, ease: "easeOut" },
  press: { duration: 0.1, ease: "easeOut" },
  sheet: { type: "spring", duration: 0.35, bounce: 0 },
  // spring(300, 30) settles in ~400ms; physics params take precedence over duration.
  flyer: { type: "spring", stiffness: 300, damping: 30 },
  hover: { duration: 0.2, ease: "easeOut" },
  credits: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  fade: { duration: 0.2, ease: "easeOut" },
  layout: { type: "spring", stiffness: 400, damping: 36 },
} satisfies Record<string, Transition>;

export const pressScale = 0.97;

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transitions.page },
};

export const sheetVariants: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: transitions.sheet },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15, ease: "easeIn" } },
};

export const flyerVariants: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1, transition: transitions.flyer },
  exit: { opacity: 0, transition: transitions.fade },
};

export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: transitions.fade },
  exit: { opacity: 0, transition: transitions.fade },
};

/** Card lift: the card moves 2px; a pre-rendered hover shadow fades in (cheaper than animating box-shadow). */
export const cardLift: Variants = {
  rest: { y: 0, transition: transitions.hover },
  hover: { y: -2, transition: transitions.hover },
};

export const cardShadow: Variants = {
  rest: { opacity: 0, transition: transitions.hover },
  hover: { opacity: 1, transition: transitions.hover },
};
