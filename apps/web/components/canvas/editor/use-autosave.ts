"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "@/lib/api/client";
import type { FlyerDoc } from "@flyer/design/canvas/types";

/** .claude/rules/canvas-editor.md: auto-save every 30 seconds, debounced, never per pixel. */
export const AUTOSAVE_MS = 30_000;
const RETRY_MS = 5_000;
const SAVED_FLASH_MS = 1_800;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const draftKey = (projectId: string) => `flyer-draft:${projectId}`;

interface Draft {
  doc: FlyerDoc;
  at: number;
}

/** A local copy written on every change; survives a hard refresh even if the last save didn't land. */
export function readDraft(projectId: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(projectId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(projectId: string, doc: FlyerDoc) {
  try {
    window.localStorage.setItem(draftKey(projectId), JSON.stringify({ doc, at: Date.now() } satisfies Draft));
  } catch {
    // Storage full or blocked: the server save still runs.
  }
}

function clearDraft(projectId: string) {
  try {
    window.localStorage.removeItem(draftKey(projectId));
  } catch {
    // ignore
  }
}

interface AutosaveOptions {
  projectId: string;
  doc: FlyerDoc;
  /** The last document known to be on the server. */
  initialSavedDoc: FlyerDoc;
  /** Runs after a successful save (thumbnail refresh). */
  onSaved?: (doc: FlyerDoc) => void;
}

export function useAutosave({ projectId, doc, initialSavedDoc, onSaved }: AutosaveOptions) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const docRef = useRef(doc);
  const savedRef = useRef(initialSavedDoc);
  const timerRef = useRef<number | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const onSavedRef = useRef(onSaved);
  // Retries go through a ref so the scheduled call always reaches the latest save().
  const saveRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const save = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (inFlight.current) await inFlight.current;
    const target = docRef.current;
    if (target === savedRef.current) return;

    setStatus("saving");
    const request = apiFetch(`/api/projects/${projectId}`, { method: "PATCH", json: { canvas: target } })
      .then(() => {
        savedRef.current = target;
        if (docRef.current === target) clearDraft(projectId);
        setStatus("saved");
        window.setTimeout(() => setStatus((current) => (current === "saved" ? "idle" : current)), SAVED_FLASH_MS);
        onSavedRef.current?.(target);
      })
      .catch(() => {
        setStatus("error");
        timerRef.current = window.setTimeout(() => void saveRef.current(), RETRY_MS);
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = request;
    await request;
  }, [projectId]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Debounce: the first unsaved change starts a 30s clock; edits inside the window ride along.
  useEffect(() => {
    docRef.current = doc;
    if (doc === savedRef.current) return;
    writeDraft(projectId, doc);
    timerRef.current ??= window.setTimeout(() => void save(), AUTOSAVE_MS);
  }, [doc, projectId, save]);

  // Leaving the page: hand the latest state to the browser so it outlives the tab.
  useEffect(() => {
    const flush = () => {
      if (docRef.current === savedRef.current) return;
      const body = JSON.stringify({ canvas: docRef.current });
      if (body.length < 60_000) {
        void fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => undefined);
      }
    };
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      flush(); // in-app navigation away from the editor
    };
  }, [projectId]);

  const isDirty = useCallback(() => docRef.current !== savedRef.current, []);
  return useMemo(() => ({ status, saveNow: save, isDirty }), [status, save, isDirty]);
}
