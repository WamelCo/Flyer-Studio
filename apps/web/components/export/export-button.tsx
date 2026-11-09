"use client";

import { AnimatePresence, motion } from "framer-motion";
import type Konva from "konva";
import { Check, Download, Link2, Lock, Share } from "lucide-react";
import { Popover } from "radix-ui";
import { Fragment, useState } from "react";

import { CheckoutSheet } from "@/components/billing/checkout-sheet";
import { useViewer } from "@/components/providers/viewer-provider";
import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { RollingNumber } from "@/components/ui/rolling-number";
import { SuccessCheck } from "@/components/ui/success-check";
import { ApiError } from "@/lib/api/client";
import type { ExportCompleteResponse } from "@/lib/api/contracts";
import type { FlyerDoc } from "@flyer/design/canvas/types";
import { fontsUsed } from "@flyer/design/render/fonts";
import { EXPORT_FORMATS, EXPORT_ORDER } from "@/lib/export/formats";
import { ExportError, runExport, type ExportStage } from "@/lib/export/run-export";
import { fadeVariants, sheetVariants, transitions } from "@/lib/motion";
import { isFormatAllowed, PLANS, type ExportFormatId } from "@flyer/billing/plans";
import { cn } from "@/lib/utils";

type State =
  | { status: "idle" }
  | { status: "working"; stage: ExportStage }
  | { status: "done"; result: ExportCompleteResponse }
  | { status: "error"; error: ApiError };

const STAGE_COPY: Record<ExportStage, { label: string; progress: number }> = {
  rendering: { label: "Rendering at full resolution…", progress: 0.35 },
  uploading: { label: "Uploading…", progress: 0.75 },
  finishing: { label: "Finishing…", progress: 0.95 },
};

/** What a designer needs to edit the file: the (free) fonts it uses, and Photoshop's one prompt. */
function DesignerNote({ doc, format }: { doc: FlyerDoc; format: ExportFormatId }) {
  const fonts = fontsUsed(doc);
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-control bg-surface p-3 text-left text-caption text-fg-secondary shadow-card">
      {fonts.length > 0 && (
        <p>
          Text stays editable with these free Google Fonts installed:{" "}
          {fonts.map((font, i) => (
            <Fragment key={font.family}>
              {i > 0 && ", "}
              <a href={font.url} target="_blank" rel="noreferrer" className="focus-ring rounded-sm font-medium text-fg underline-offset-2 hover:underline">
                {font.family}
              </a>
            </Fragment>
          ))}
          .
        </p>
      )}
      {format === "psd" && <p>Photoshop asks to update text layers when it opens the file — choose Update.</p>}
    </div>
  );
}

interface ExportButtonProps {
  projectId: string;
  title?: string;
  doc: FlyerDoc;
  getPage: () => Konva.Group | null;
  variant?: "bar" | "capsule";
}

export function ExportButton({ projectId, title = "Flyer", doc, getPage, variant = "bar" }: ExportButtonProps) {
  const { viewer, setCredits } = useViewer();
  const plan = PLANS[viewer.plan];
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormatId>("png");
  const [state, setState] = useState<State>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const spec = EXPORT_FORMATS[format];
  const locked = !isFormatAllowed(viewer.plan, format);
  const short = viewer.credits < spec.cost;
  const insufficient = (state.status === "error" && state.error.code === "INSUFFICIENT_CREDITS") || (!locked && short);
  const planLocked = locked || (state.status === "error" && state.error.code === "PLAN_LOCKED");

  async function start() {
    const page = getPage();
    if (!page) return;
    setState({ status: "working", stage: "rendering" });
    try {
      const result = await runExport({
        page,
        doc,
        projectId,
        title,
        format,
        watermark: plan.watermark,
        onStage: (stage) => setState({ status: "working", stage }),
        onCharged: setCredits,
      });
      setState({ status: "done", result });
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError("INTERNAL_ERROR", "Export failed. Try again.", 500);
      if (error instanceof ExportError && error.refundedBalance !== undefined) setCredits(error.refundedBalance);
      if (typeof error.details?.balance === "number") setCredits(error.details.balance);
      setState({ status: "error", error });
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function onOpenChange(next: boolean) {
    if (state.status === "working") return; // keep the sheet up until the export settles
    setOpen(next);
    if (!next) {
      setState({ status: "idle" });
      setCopied(false);
    }
  }

  const upgrade = (
    <Button size="sm" variant="primary" onClick={() => setCheckoutOpen(true)}>
      Upgrade
    </Button>
  );

  return (
    <>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger asChild>
          {variant === "capsule" ? (
            <Button size="lg" shape="capsule" className="shadow-float">
              <Share />
              Export
            </Button>
          ) : (
            <Button size="sm">Export</Button>
          )}
        </Popover.Trigger>
        <AnimatePresence>
          {open && (
            <Popover.Portal forceMount>
              <Popover.Content
                forceMount
                asChild
                align="end"
                side={variant === "capsule" ? "top" : "bottom"}
                sideOffset={8}
                collisionPadding={8}
                onInteractOutside={(event) => state.status === "working" && event.preventDefault()}
              >
                <motion.div
                  variants={sheetVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
                  className="material z-40 flex w-80 flex-col gap-4 rounded-panel p-4 shadow-float"
                >
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-headline text-fg">Export</h2>
                    <span className="text-caption text-fg-secondary">
                      <RollingNumber value={viewer.credits} className="font-semibold text-fg" /> credits
                    </span>
                  </div>

                  <AnimatePresence mode="wait" initial={false}>
                    {state.status === "done" ? (
                      <motion.div key="done" variants={fadeVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col items-center gap-4 py-2 text-center">
                        <SuccessCheck />
                        <p className="text-callout text-fg">Your {EXPORT_FORMATS[state.result.format].label} file is ready.</p>
                        {EXPORT_FORMATS[state.result.format].editable && <DesignerNote doc={doc} format={state.result.format} />}
                        <div className="grid w-full grid-cols-2 gap-2">
                          <a
                            href={state.result.downloadUrl}
                            className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-button bg-accent text-callout font-medium text-accent-contrast hover:brightness-110"
                          >
                            <Download className="size-4" />
                            Download
                          </a>
                          <Button variant="secondary" onClick={() => void copyLink(state.result.shareUrl)}>
                            {copied ? <Check /> : <Link2 />}
                            {copied ? "Copied" : "Copy link"}
                          </Button>
                        </div>
                        <Button variant="plain" size="sm" onClick={() => setState({ status: "idle" })}>
                          Export another format
                        </Button>
                      </motion.div>
                    ) : (
                      <motion.div key="form" variants={fadeVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col gap-4">
                        <div role="radiogroup" aria-label="Format" className="flex flex-col gap-1">
                          {EXPORT_ORDER.map((id, index) => {
                            const option = EXPORT_FORMATS[id];
                            const allowed = isFormatAllowed(viewer.plan, id);
                            const selected = id === format;
                            const firstEditable = option.editable && !EXPORT_FORMATS[EXPORT_ORDER[index - 1]!]?.editable;
                            return (
                              <Fragment key={id}>
                              {firstEditable && <p className="px-3 pt-2 text-caption font-medium text-fg-secondary">Editable files</p>}
                              <button
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                disabled={state.status === "working"}
                                onClick={() => {
                                  setFormat(id);
                                  if (state.status === "error") setState({ status: "idle" });
                                }}
                                className={cn(
                                  "focus-ring flex items-center gap-3 rounded-control px-3 py-2 text-left",
                                  selected ? "bg-surface shadow-card" : "hover:bg-fill",
                                )}
                              >
                                <span
                                  aria-hidden
                                  className={cn("size-4 shrink-0 rounded-full", selected ? "border-4 border-accent bg-surface" : "border border-separator bg-surface")}
                                />
                                <span className="flex min-w-0 flex-1 flex-col">
                                  <span className="text-callout font-medium text-fg">{option.label}</span>
                                  <span className="text-caption text-fg-secondary">{option.detail}</span>
                                </span>
                                {allowed ? (
                                  <span className="text-caption text-fg-secondary">
                                    {option.cost} credit{option.cost === 1 ? "" : "s"}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-caption font-medium text-fg-secondary">
                                    <Lock className="size-3" />
                                    Pro
                                  </span>
                                )}
                              </button>
                              </Fragment>
                            );
                          })}
                        </div>

                        {plan.watermark && !planLocked && (
                          <p className="text-caption text-fg-secondary">Free exports carry a small watermark.</p>
                        )}

                        {state.status === "working" ? (
                          <div className="flex flex-col gap-2" role="status" aria-live="polite">
                            <div className="h-1 overflow-hidden rounded-full bg-fill">
                              <motion.div
                                className="h-full origin-left rounded-full bg-accent"
                                initial={{ scaleX: 0.05 }}
                                animate={{ scaleX: STAGE_COPY[state.stage].progress }}
                                transition={transitions.credits}
                              />
                            </div>
                            <span className="text-caption text-fg-secondary">{STAGE_COPY[state.stage].label}</span>
                          </div>
                        ) : planLocked ? (
                          <div className="flex items-center justify-between gap-3 rounded-control bg-surface p-3 shadow-card">
                            <span className="flex items-center gap-2 text-callout text-fg">
                              <Lock className="size-4 text-fg-secondary" />
                              {spec.label} is on Pro and Max
                            </span>
                            {upgrade}
                          </div>
                        ) : insufficient ? (
                          <div className="flex flex-col gap-3 rounded-control bg-surface p-3 shadow-card">
                            <p className="text-callout text-fg">
                              {spec.label} needs {spec.cost} credit{spec.cost === 1 ? "" : "s"}. You have {viewer.credits}.
                            </p>
                            <div className="flex justify-end">{upgrade}</div>
                          </div>
                        ) : (
                          <Button size="lg" onClick={() => void start()}>
                            Export {spec.label} · {spec.cost} credit{spec.cost === 1 ? "" : "s"}
                          </Button>
                        )}

                        {state.status === "error" && !["INSUFFICIENT_CREDITS", "PLAN_LOCKED"].includes(state.error.code) && (
                          <InlineMessage>{state.error.message}</InlineMessage>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </Popover.Content>
            </Popover.Portal>
          )}
        </AnimatePresence>
      </Popover.Root>
      <CheckoutSheet open={checkoutOpen} onOpenChange={setCheckoutOpen} plan="pro" interval="year" returnPath="/billing" />
    </>
  );
}
