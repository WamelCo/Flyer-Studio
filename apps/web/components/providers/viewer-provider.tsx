"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { PlanId } from "@flyer/core/stripe/plans";

export interface Viewer {
  id: string;
  email: string;
  plan: PlanId;
  credits: number;
}

interface ViewerContextValue {
  viewer: Viewer;
  /** Apply a balance returned by the server. Never computed on the client. */
  setCredits: (credits: number) => void;
  setPlan: (plan: PlanId) => void;
}

const ViewerContext = createContext<ViewerContextValue | null>(null);

export function ViewerProvider({ initialViewer, children }: { initialViewer: Viewer; children: ReactNode }) {
  const [viewer, setViewer] = useState(initialViewer);
  const setCredits = useCallback((credits: number) => setViewer((v) => ({ ...v, credits })), []);
  const setPlan = useCallback((plan: PlanId) => setViewer((v) => ({ ...v, plan })), []);

  const value = useMemo<ViewerContextValue>(() => ({ viewer, setCredits, setPlan }), [viewer, setCredits, setPlan]);

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer() {
  const context = useContext(ViewerContext);
  if (!context) throw new Error("useViewer must be used inside <ViewerProvider>");
  return context;
}

/** For components that also render on public pages (e.g. the checkout sheet on /pricing). */
export function useOptionalViewer() {
  return useContext(ViewerContext);
}
