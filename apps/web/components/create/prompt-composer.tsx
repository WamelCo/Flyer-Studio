"use client";

import { ArrowUp, ImagePlus, X } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { MAX_PROMPT_LENGTH } from "@flyer/core/ai/prompt";
import { FORMAT_ORDER, FORMATS } from "@flyer/core/canvas/formats";
import type { FlyerFormat } from "@flyer/core/canvas/types";
import { CREDIT_COSTS } from "@flyer/core/stripe/plans";
import { uploadPublic } from "@/lib/storage";
import { cn } from "@/lib/utils";

/** A style reference the user attached: its stored URL and a local preview. */
export interface StyleReference {
  url: string;
  previewUrl: string;
}

const REFERENCE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

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
  /** Optional style reference: the generated designs follow its colours and look. */
  reference?: StyleReference | null;
  onReferenceChange?: (reference: StyleReference | null) => void;
}

export const PromptComposer = forwardRef<PromptComposerHandle, PromptComposerProps>(function PromptComposer(
  { prompt, onPromptChange, format, onFormatChange, onSubmit, busy, compact, reference, onReferenceChange },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  async function onReferencePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onReferenceChange) return;
    setReferenceError(null);
    if (!REFERENCE_TYPES.includes(file.type)) return setReferenceError("Use a PNG, JPEG or WebP image.");
    if (file.size > MAX_REFERENCE_BYTES) return setReferenceError("References must be 10 MB or smaller.");
    setUploading(true);
    try {
      const url = await uploadPublic(file, { kind: "reference", contentType: file.type });
      onReferenceChange({ url, previewUrl: URL.createObjectURL(file) });
    } catch {
      setReferenceError("Couldn't upload that image. Try again.");
    } finally {
      setUploading(false);
    }
  }
  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  // Grow with the content up to a few lines.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [prompt, compact]);

  const remaining = MAX_PROMPT_LENGTH - prompt.length;
  const canSubmit = prompt.trim().length >= 3 && remaining >= 0 && !busy && !uploading;

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
        {onReferenceChange &&
          (reference ? (
            <span className="flex items-center gap-2 rounded-full bg-fill py-1 pr-1 pl-1 text-caption text-fg">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
              <img src={reference.previewUrl} alt="" className="size-6 rounded-full object-cover" />
              Style reference
              <Button type="button" variant="ghost" size="icon-sm" shape="capsule" onClick={() => onReferenceChange(null)} disabled={busy} aria-label="Remove style reference">
                <X />
              </Button>
            </span>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={busy || uploading}>
              <ImagePlus />
              {uploading ? "Uploading…" : "Style reference"}
            </Button>
          ))}
        <input ref={fileRef} type="file" accept={REFERENCE_TYPES.join(",")} className="hidden" onChange={onReferencePicked} />
        <div className="ml-auto flex items-center gap-3">
          <span className={cn("text-caption", remaining < 40 ? "text-danger" : "text-fg-secondary")}>
            {remaining < 40 ? `${remaining} left` : `${CREDIT_COSTS.generate} credits`}
          </span>
          <Button type="submit" size="icon" shape="capsule" disabled={!canSubmit} aria-label="Generate flyer">
            <ArrowUp />
          </Button>
        </div>
      </div>
      {referenceError && <p className="text-caption text-danger">{referenceError}</p>}
    </form>
  );
});
