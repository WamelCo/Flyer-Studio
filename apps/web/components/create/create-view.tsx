"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type Konva from "konva";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { CheckoutSheet } from "@/components/billing/checkout-sheet";
import { GeneratingFrame, ResultFrame } from "@/components/create/generation-stage";
import { PromptComposer, type PromptComposerHandle, type StyleReference } from "@/components/create/prompt-composer";
import { ProjectGrid } from "@/components/projects/project-grid";
import { useViewer } from "@/components/providers/viewer-provider";
import { useShell } from "@/components/shell/shell-provider";
import { Button } from "@/components/ui/button";
import { InlineMessage } from "@/components/ui/inline-message";
import { ApiError, apiFetch } from "@/lib/api/client";
import type { GenerateResponse, ProjectSummary, RenderStatus } from "@flyer/core/api/contracts";
import type { FlyerFormat } from "@flyer/core/canvas/types";
import { saveThumbnail } from "@/lib/canvas/thumbnail";
import { fadeVariants, transitions } from "@/lib/motion";
import { CREDIT_COSTS, PLANS } from "@flyer/core/stripe/plans";
import { formatCredits } from "@/lib/utils";

const EXAMPLES = [
  "Summer jazz night at the Blue Room, Friday 8pm, tickets $15",
  "50% off everything this weekend at Juniper & Co.",
  "Open house Sunday 1–4pm, 3 bed modern home on Maple Street",
];

/** How often to poll a render, and how long to wait before suggesting the editable version. */
const RENDER_POLL_MS = 3_000;
const RENDER_WAIT_MS = 8 * 60_000;

type Generation =
  | { status: "idle" }
  | { status: "generating"; format: FlyerFormat }
  | { status: "done"; result: GenerateResponse }
  | { status: "error"; error: ApiError };

function Result({ result, onReset, onRetry }: { result: GenerateResponse; onReset: () => void; onRetry: () => void }) {
  const router = useRouter();
  const { docs } = result;
  const { setCredits } = useViewer();
  const [selected, setSelected] = useState(0);
  const [opening, setOpening] = useState(false);
  const [rendering, setRendering] = useState(false);
  /** Seconds since the render started, shown on the button. */
  const [elapsed, setElapsed] = useState(0);
  /** Variants rendered in this session: the first render is included, others cost credits. */
  const [renderedCount, setRenderedCount] = useState(0);
  const busy = opening || rendering;
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef<Konva.Group | null>(null);
  const thumbnailSaved = useRef(false);

  const onMainReady = useCallback(
    (page: Konva.Group, index: number) => {
      pageRef.current = page;
      if (index === 0 && !thumbnailSaved.current) {
        thumbnailSaved.current = true;
        // Background, best effort: the grid falls back to the raw artwork.
        saveThumbnail(page, docs[0]!, { projectId: result.projectId }).catch(() => undefined);
      }
    },
    [docs, result.projectId],
  );

  async function openInEditor() {
    setOpening(true);
    setError(null);
    try {
      if (selected !== 0) {
        await apiFetch(`/api/projects/${result.projectId}`, { method: "PATCH", json: { canvas: docs[selected] } });
        // The server tracked the first direction's photos; this one is now in use instead.
        for (const downloadLocation of result.photoDownloads[selected] ?? []) {
          void apiFetch("/api/photos/track", { method: "POST", json: { downloadLocation } }).catch(() => undefined);
        }
        if (pageRef.current) {
          await saveThumbnail(pageRef.current, docs[selected]!, { projectId: result.projectId }).catch(
            () => undefined,
          );
        }
      }
      router.push(`/editor/${result.projectId}`);
    } catch (caught) {
      setOpening(false);
      setError(caught instanceof ApiError ? caught.message : "Couldn't open the editor. Try again.");
    }
  }

  /**
   * Only the chosen design is rendered (Ideogram, from the engine's exact layout). The
   * server starts the render and answers at once; this polls until it's done, so a slow
   * renderer means a longer wait, never a timed-out request.
   */
  async function renderAndOpen() {
    setRendering(true);
    setElapsed(0);
    setError(null);
    const started = Date.now();
    const tick = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    try {
      const variant = selected;
      let status = await apiFetch<RenderStatus>(`/api/generate/${result.jobId}/render`, { method: "POST", json: { variant } });
      if (status.charged > 0) setCredits(status.balance);
      while (status.status === "pending") {
        if (Date.now() - started > RENDER_WAIT_MS) {
          throw new ApiError("GENERATION_TIMEOUT", "Rendering is taking unusually long. Open the editable version, or try again in a minute.", 504);
        }
        await new Promise((resolve) => window.setTimeout(resolve, RENDER_POLL_MS));
        status = await apiFetch<RenderStatus>(`/api/generate/${result.jobId}/render/${variant}`);
      }
      setRenderedCount((count) => count + 1);
      router.push(`/editor/${result.projectId}`);
    } catch (caught) {
      setRendering(false);
      if (caught instanceof ApiError && typeof caught.details?.balance === "number") setCredits(caught.details.balance);
      setError(caught instanceof ApiError ? caught.message : "Couldn't render this design. Open the editable version instead.");
    } finally {
      window.clearInterval(tick);
    }
  }

  return (
    <ResultFrame
      result={result}
      selected={selected}
      onSelect={setSelected}
      onMainReady={onMainReady}
      actions={
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {result.renderable && (
              <Button size="lg" onClick={renderAndOpen} disabled={busy}>
                <Sparkles />
                {rendering ? `Rendering… ${elapsed}s` : renderedCount > 0 ? `Render this one · ${CREDIT_COSTS.render} credits` : "Render & open"}
              </Button>
            )}
            <Button size="lg" variant={result.renderable ? "secondary" : "primary"} onClick={openInEditor} disabled={busy}>
              {opening ? "Opening…" : result.renderable ? "Open editable" : "Open in editor"}
              <ArrowRight />
            </Button>
            {!result.renderable && (
              <Button size="lg" variant="secondary" onClick={onRetry} disabled={busy}>
                <RotateCcw />
                Try again
              </Button>
            )}
          </div>
          {result.renderable && (
            <p className="max-w-(--prose-max) text-center text-caption text-fg-secondary">
              Rendering finishes the selected design as a polished graphic. Open editable keeps every element editable.
            </p>
          )}
          <div className="flex items-center gap-4">
            {result.renderable && (
              <Button variant="plain" size="sm" onClick={onRetry} disabled={busy}>
                Try again
              </Button>
            )}
            <Button variant="plain" size="sm" onClick={onReset} disabled={busy}>
              Start a new flyer
            </Button>
          </div>
          <InlineMessage>{error}</InlineMessage>
        </div>
      }
    />
  );
}

function GenerationError({ error, onRetry, onEdit }: { error: ApiError; onRetry: () => void; onEdit: () => void }) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const retryable = ["GENERATION_FAILED", "GENERATION_TIMEOUT", "NETWORK_ERROR", "INTERNAL_ERROR"].includes(error.code);

  return (
    <motion.div
      variants={fadeVariants}
      initial="initial"
      animate="animate"
      className="flex w-full max-w-(--prose-max) flex-col items-center gap-4 rounded-panel bg-surface p-6 text-center shadow-card"
    >
      <p className="text-headline text-fg">
        {error.code === "INSUFFICIENT_CREDITS" ? "You're out of credits" : "That one didn't come together"}
      </p>
      <p className="text-callout text-fg-secondary">{error.message}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {error.code === "INSUFFICIENT_CREDITS" && (
          <>
            <Button onClick={() => setCheckoutOpen(true)}>Get {formatCredits(PLANS.pro.monthlyCredits)} credits with Pro</Button>
            <CheckoutSheet open={checkoutOpen} onOpenChange={setCheckoutOpen} plan="pro" interval="year" returnPath="/dashboard" />
          </>
        )}
        {retryable && <Button onClick={onRetry}>Try again</Button>}
        {error.code === "GENERATION_BLOCKED" && <Button onClick={onEdit}>Edit prompt</Button>}
      </div>
    </motion.div>
  );
}

export function CreateView({ recentProjects }: { recentProjects: ProjectSummary[] }) {
  const router = useRouter();
  const { collapsed, setCollapsed } = useShell();
  const { setCredits } = useViewer();
  const composerRef = useRef<PromptComposerHandle>(null);
  const sidebarBefore = useRef(collapsed);

  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState<FlyerFormat>("poster");
  const [reference, setReference] = useState<StyleReference | null>(null);
  const [generation, setGeneration] = useState<Generation>({ status: "idle" });
  const active = generation.status !== "idle";

  async function generate() {
    if (generation.status === "idle") sidebarBefore.current = collapsed;
    // Focus mode: the sidebar steps aside while the canvas takes the stage.
    setCollapsed(true, { persist: false });
    setGeneration({ status: "generating", format });

    try {
      const result = await apiFetch<GenerateResponse>("/api/generate", { method: "POST", json: { prompt, format, ...(reference && { referenceUrl: reference.url }) } });
      setCredits(result.balance);
      setGeneration({ status: "done", result });
      router.refresh();
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError("INTERNAL_ERROR", "Something went wrong.", 500);
      if (error.code === "UNAUTHORIZED") {
        router.push("/login?next=/dashboard");
        return;
      }
      if (typeof error.details?.balance === "number") setCredits(error.details.balance);
      setGeneration({ status: "error", error });
    }
  }

  function reset() {
    setGeneration({ status: "idle" });
    setPrompt("");
    setCollapsed(sidebarBefore.current, { persist: false });
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  return (
    <LayoutGroup>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-1 flex-col gap-8 px-6 py-8 md:px-10">
        <motion.section
          layout="position"
          transition={transitions.layout}
          className={
            active
              ? "mx-auto flex w-full max-w-(--prose-max) flex-col gap-4"
              : "mx-auto flex min-h-[56dvh] w-full max-w-(--prose-max) flex-col justify-center gap-6"
          }
        >
          <AnimatePresence initial={false}>
            {!active && (
              <motion.h1
                layout="position"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="text-center text-large-title text-fg"
              >
                What are we making?
              </motion.h1>
            )}
          </AnimatePresence>
          <motion.div layout="position" transition={transitions.layout}>
            <PromptComposer
              ref={composerRef}
              prompt={prompt}
              onPromptChange={setPrompt}
              format={format}
              onFormatChange={setFormat}
              onSubmit={generate}
              busy={generation.status === "generating"}
              compact={active}
              reference={reference}
              onReferenceChange={setReference}
            />
          </motion.div>
          <AnimatePresence initial={false}>
            {!active && (
              <motion.div
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex flex-wrap justify-center gap-2"
              >
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setPrompt(example);
                      composerRef.current?.focus();
                    }}
                    className="focus-ring rounded-full bg-fill px-4 py-2 text-callout text-fg hover:bg-fill-strong"
                  >
                    {example}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {generation.status === "generating" && <GeneratingFrame format={generation.format} />}
        {generation.status === "done" && (
          <Result key={generation.result.jobId} result={generation.result} onReset={reset} onRetry={generate} />
        )}
        {generation.status === "error" && (
          <div className="flex justify-center">
            <GenerationError error={generation.error} onRetry={generate} onEdit={() => composerRef.current?.focus()} />
          </div>
        )}

        {!active && recentProjects.length > 0 && (
          <section aria-labelledby="recent-heading" className="flex flex-col gap-4">
            <h2 id="recent-heading" className="text-headline text-fg">
              Recent
            </h2>
            <ProjectGrid projects={recentProjects} />
          </section>
        )}
      </div>
    </LayoutGroup>
  );
}
