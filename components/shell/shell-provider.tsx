"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { SIDEBAR_COOKIE } from "@/lib/layout";

interface ShellContextValue {
  collapsed: boolean;
  /** `persist: false` is for transient focus modes, e.g. while generating. */
  setCollapsed: (collapsed: boolean, options?: { persist?: boolean }) => void;
  toggle: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ initialCollapsed, children }: { initialCollapsed: boolean; children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);

  const setCollapsed = useCallback<ShellContextValue["setCollapsed"]>((next, options) => {
    setCollapsedState(next);
    if (options?.persist !== false) {
      document.cookie = `${SIDEBAR_COOKIE}=${next ? 1 : 0}; path=/; max-age=31536000; samesite=lax`;
    }
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  // ⌘\ / Ctrl+\ toggles the sidebar, like Finder and Xcode.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "\\" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const value = useMemo(() => ({ collapsed, setCollapsed, toggle }), [collapsed, setCollapsed, toggle]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <ShellProvider>");
  return context;
}
