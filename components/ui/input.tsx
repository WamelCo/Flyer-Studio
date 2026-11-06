import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const inputClassName =
  "focus-ring h-12 w-full rounded-control bg-surface px-4 text-body text-fg shadow-card placeholder:text-fg-secondary disabled:opacity-60 aria-invalid:shadow-invalid";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClassName, className)} {...props} />;
});
