"use client";

import { motion } from "framer-motion";
import { useId, type ReactNode } from "react";

import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}

/** Apple-style segmented control: a single thumb slides between options. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  const thumbId = useId();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex items-center gap-1 rounded-control bg-fill p-1", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "focus-ring relative inline-flex items-center justify-center gap-2 rounded-button px-4 text-callout font-medium",
              size === "sm" ? "h-8 px-3" : "h-9",
              selected ? "text-fg" : "text-fg-secondary hover:text-fg",
            )}
          >
            {selected && (
              <motion.span
                layoutId={thumbId}
                transition={transitions.layout}
                className="absolute inset-0 rounded-button bg-surface shadow-card"
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
