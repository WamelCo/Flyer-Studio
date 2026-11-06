"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useState, type ReactNode } from "react";

import { fadeVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  shortcut?: string;
  className?: string;
}

export function Tooltip({ content, children, side = "right", shortcut, className }: TooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen} delayDuration={400}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <AnimatePresence>
        {open && (
          <TooltipPrimitive.Portal forceMount>
            <TooltipPrimitive.Content forceMount side={side} sideOffset={8} asChild>
              <motion.div
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className={cn(
                  "material z-50 flex items-center gap-2 rounded-button px-2 py-1 text-caption font-medium text-fg shadow-float",
                  className,
                )}
              >
                {content}
                {shortcut && <kbd className="font-sans text-caption text-fg-secondary">{shortcut}</kbd>}
              </motion.div>
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        )}
      </AnimatePresence>
    </TooltipPrimitive.Root>
  );
}
