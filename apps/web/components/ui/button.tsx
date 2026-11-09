"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { motion, type HTMLMotionProps } from "framer-motion";
import Link from "next/link";
import { forwardRef, type ComponentProps } from "react";

import { pressScale, transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "focus-ring relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-button disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-contrast hover:brightness-110",
        secondary: "bg-fill text-fg hover:bg-fill-strong",
        ghost: "text-fg hover:bg-fill",
        plain: "text-accent-text hover:underline underline-offset-4",
        danger: "bg-fill text-danger hover:bg-fill-strong",
      },
      size: {
        sm: "h-8 px-3 text-callout",
        md: "h-10 px-4 text-callout font-medium",
        lg: "h-12 px-6 text-headline [&_svg]:size-5",
        icon: "size-10 text-callout [&_svg]:size-5",
        "icon-sm": "size-8 text-callout",
      },
      shape: {
        default: "",
        capsule: "rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md", shape: "default" },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export type ButtonProps = Omit<HTMLMotionProps<"button">, "ref"> & ButtonVariantProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, shape, type = "button", ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      whileTap={props.disabled ? undefined : { scale: pressScale }}
      transition={transitions.press}
      className={cn(buttonVariants({ variant, size, shape }), className)}
      {...props}
    />
  );
});

const MotionLink = motion.create(Link);

export type ButtonLinkProps = Omit<ComponentProps<typeof MotionLink>, "ref"> & ButtonVariantProps;

export function ButtonLink({ className, variant, size, shape, ...props }: ButtonLinkProps) {
  return (
    <MotionLink
      whileTap={{ scale: pressScale }}
      transition={transitions.press}
      className={cn(buttonVariants({ variant, size, shape }), className)}
      {...props}
    />
  );
}
