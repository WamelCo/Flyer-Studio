"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

import { fadeVariants, sheetVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Visually hide the title (still announced). */
  hideHeader?: boolean;
}

/**
 * Modal sheet on the control layer: translucent, blurred, scale 0.96 → 1 with a 350ms
 * spring. Content placed inside should sit on solid surfaces.
 */
export function Sheet({ open, onOpenChange, title, description, children, className, hideHeader }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <motion.div
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="fixed inset-0 z-40 bg-scrim"
              />
            </Dialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
              <Dialog.Content forceMount asChild {...(description ? {} : { "aria-describedby": undefined })}>
                <motion.div
                  variants={sheetVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className={cn(
                    "material pointer-events-auto relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-panel shadow-float sm:max-w-lg sm:rounded-panel",
                    className,
                  )}
                >
                  <div className={cn("flex items-start justify-between gap-4 p-6 pb-4", hideHeader && "sr-only")}>
                    <div className="flex flex-col gap-1">
                      <Dialog.Title className="text-headline text-fg">{title}</Dialog.Title>
                      {description && (
                        <Dialog.Description className="text-callout text-fg-secondary">{description}</Dialog.Description>
                      )}
                    </div>
                  </div>
                  <Dialog.Close
                    aria-label="Close"
                    className="focus-ring absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-full bg-fill text-fg-secondary hover:text-fg"
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                  <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
