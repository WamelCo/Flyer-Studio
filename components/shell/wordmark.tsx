import { cn } from "@/lib/utils";

export const PRODUCT_NAME = "Flyer Studio";

export function LogoGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-button bg-accent text-accent-contrast", className)}
    >
      <svg viewBox="0 0 20 20" className="size-5" fill="none">
        <path d="M5 3.5h7l3 3v10H5z" fill="currentColor" fillOpacity="0.95" />
        <path d="M12 3.5v3h3" stroke="var(--accent)" strokeWidth="1.2" />
        <path d="M7.5 10h5M7.5 12.5h3.5" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Wordmark({ className, hideText }: { className?: string; hideText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoGlyph />
      {!hideText && <span className="text-headline whitespace-nowrap text-fg">{PRODUCT_NAME}</span>}
    </span>
  );
}
