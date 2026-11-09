"use client";

import { motion } from "framer-motion";

import { transitions } from "@/lib/motion";
import { cn, formatCredits } from "@/lib/utils";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

function Digit({ digit }: { digit: number }) {
  return (
    <span className="relative inline-block overflow-hidden" style={{ height: "1em", width: "1ch" }}>
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col"
        initial={false}
        animate={{ y: `${-digit * 10}%` }}
        transition={transitions.credits}
      >
        {DIGITS.map((d) => (
          <span key={d} className="block text-center" style={{ height: "1em" }}>
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/** Odometer-style number: each digit rolls to its new value over 500ms. */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const chars = formatCredits(value).split("");

  return (
    <span className={cn("relative inline-flex tabular-nums", className)} style={{ lineHeight: 1 }}>
      <span className="sr-only">{formatCredits(value)}</span>
      <span aria-hidden className="inline-flex">
        {chars.map((char, index) => {
          // Key from the right so existing digits keep their identity when the length changes.
          const key = chars.length - index;
          return /\d/.test(char) ? (
            <Digit key={`d${key}`} digit={Number(char)} />
          ) : (
            <span key={`s${key}`}>{char}</span>
          );
        })}
      </span>
    </span>
  );
}
