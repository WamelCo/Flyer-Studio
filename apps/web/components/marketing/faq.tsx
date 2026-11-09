"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useId, useState } from "react";

import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface FaqItem {
  question: string;
  answer: string;
}

/** Questions and answers as a disclosure list: one open at a time, hairline-separated. */
export function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const id = useId();

  return (
    <ul className="divide-y divide-separator border-y border-separator">
      {items.map((item, index) => {
        const expanded = open === index;
        return (
          <li key={item.question}>
            <h3>
              <button
                type="button"
                id={`${id}-q${index}`}
                aria-expanded={expanded}
                aria-controls={`${id}-a${index}`}
                onClick={() => setOpen(expanded ? null : index)}
                className="focus-ring flex w-full items-center justify-between gap-6 rounded-button py-5 text-left text-headline text-fg"
              >
                {item.question}
                <motion.span animate={{ rotate: expanded ? 45 : 0 }} transition={transitions.hover} className="shrink-0 text-fg-secondary">
                  <Plus aria-hidden className="size-5" />
                </motion.span>
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  id={`${id}-a${index}`}
                  role="region"
                  aria-labelledby={`${id}-q${index}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1, transition: transitions.sheet }}
                  exit={{ height: 0, opacity: 0, transition: transitions.fade }}
                  className="overflow-hidden"
                >
                  <p className={cn("max-w-(--prose-max) pb-6 text-body text-fg-secondary")}>{item.answer}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}
