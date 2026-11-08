"use client";

import { ArrowUp } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { MAX_PROMPT_LENGTH } from "@flyer/core/ai/prompt";
import { FORMAT_ORDER, FORMATS } from "@flyer/core/canvas/formats";
import type { FlyerFormat } from "@flyer/core/canvas/types";
import { CREDIT_COSTS } from "@flyer/core/stripe/plans";
import { cn } from "@/lib/utils";

export interface PromptComposerHandle {
  focus: () => void;
}

interface PromptComposerProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  format: FlyerFormat;
  onFormatChange: (format: FlyerFormat) => void;
  onSubmit: () => void;
  busy: boolean;
  compact?: boolean;
}

export const PromptComposer = forwardRef<PromptComposerHandle, PromptComposerProps>(function PromptComposer(
  { prompt, onPromptChange, format, onFormatChange, onSubmit, busy, compact },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  // Grow with the content up to a few lines.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [prompt, compact]);

  const remaining = MAX_PROMPT_LENGTH - prompt.length;
  const canSubmit = prompt.trim().length >= 3 && remaining >= 0 && !busy;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canSubmit) onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="focus-within:shadow-focus flex w-full flex-col gap-3 rounded-panel bg-surface p-4 shadow-card"
    >
      <label htmlFor="prompt" className="sr-only">
        Describe your flyer
      </label>
      <textarea
        ref={textareaRef}
        id="prompt"
        rows={compact ? 1 : 2}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Describe your flyer — what, where, when…"
        maxLength={MAX_PROMPT_LENGTH}
        disabled={busy}
        className={cn(
          "max-h-48 w-full resize-none bg-transparent text-fg outline-none placeholder:text-fg-secondary disabled:opacity-60",
          compact ? "text-body" : "text-headline font-normal",
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Format"
          size="sm"
          value={format}
          onChange={onFormatChange}
          options={FORMAT_ORDER.map((id) => ({ value: id, label: FORMATS[id].label }))}
        />
        <div className="ml-auto flex items-center gap-3">
          <span className={cn("text-caption", remaining < 40 ? "text-danger" : "text-fg-secondary")}>
            {remaining < 40 ? `${remaining} left` : `${CREDIT_COSTS.generate} credits`}
          </span>
          <Button type="submit" size="icon" shape="capsule" disabled={!canSubmit} aria-label="Generate flyer">
            <ArrowUp />
          </Button>
        </div>
      </div>
    </form>
  );
});
