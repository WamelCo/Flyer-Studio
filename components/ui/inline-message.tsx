"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Inline status line that animates in and out. Errors live here — never in modals. */
export function InlineMessage({
  children,
  tone = "danger",
  className,
}: {
  children: ReactNode;
  tone?: "danger" | "neutral" | "success";
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {children && (
        <motion.p
          role={tone === "danger" ? "alert" : "status"}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={transitions.fade}
          className={cn(
            "overflow-hidden text-callout",
            tone === "danger" && "text-danger",
            tone === "neutral" && "text-fg-secondary",
            tone === "success" && "text-success",
            className,
          )}
        >
          {children}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
