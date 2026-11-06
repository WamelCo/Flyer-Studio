"use client";

import { useSyncExternalStore } from "react";

type Entry = { status: "loading" | "loaded" | "failed"; image: HTMLImageElement; listeners: Set<() => void> };

const cache = new Map<string, Entry>();

function entryFor(src: string): Entry {
  let entry = cache.get(src);
  if (entry) return entry;

  const image = new window.Image();
  // Storage serves CORS headers; anonymous mode keeps the canvas exportable.
  image.crossOrigin = "anonymous";
  const created: Entry = { status: "loading", image, listeners: new Set() };
  const settle = (status: Entry["status"]) => {
    created.status = status;
    for (const listener of created.listeners) listener();
  };
  image.onload = () => settle("loaded");
  image.onerror = () => settle("failed");
  image.src = src;
  cache.set(src, created);
  entry = created;
  return entry;
}

const noop = () => () => undefined;

/** Shared, cached image loading for Konva nodes. An empty src (a photo slot) loads nothing. */
export function useImage(src: string): HTMLImageElement | undefined {
  return useSyncExternalStore(
    !src ? noop : (onChange) => {
      const entry = entryFor(src);
      entry.listeners.add(onChange);
      return () => entry.listeners.delete(onChange);
    },
    () => {
      if (!src) return undefined;
      const entry = entryFor(src);
      return entry.status === "loaded" ? entry.image : undefined;
    },
    () => undefined,
  );
}

/** Resolves when every image in the list has loaded (or failed). Used before export. */
export function preloadImages(srcs: string[]) {
  return Promise.all(
    srcs.filter(Boolean).map(
      (src) =>
        new Promise<void>((resolve) => {
          const entry = entryFor(src);
          if (entry.status !== "loading") return resolve();
          const done = () => {
            entry.listeners.delete(done);
            resolve();
          };
          entry.listeners.add(done);
        }),
    ),
  );
}
