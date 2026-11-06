"use client";

import type Konva from "konva";

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const FIT_PADDING = 48;

const clampZoom = (scale: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

/**
 * Zoom/pan lives outside React. Changes are coalesced into one requestAnimationFrame,
 * applied imperatively to the Konva stage, then broadcast to DOM overlays (page shadow,
 * context toolbar, text editor) — no React render per frame, so drag and zoom hold 60fps.
 */
export class Viewport {
  private view: View = { scale: 1, x: 0, y: 0 };
  private stage: Konva.Stage | null = null;
  private frame = 0;
  private listeners = new Set<() => void>();
  /** True until the user zooms or pans; resizes refit only while this holds. */
  fitted = true;

  get = () => this.view;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  attach(stage: Konva.Stage | null) {
    this.stage = stage;
    this.schedule();
  }

  set(next: View, { fitted = false } = {}) {
    this.view = { ...next, scale: clampZoom(next.scale) };
    this.fitted = fitted;
    this.schedule();
  }

  fit(container: { width: number; height: number }, page: { width: number; height: number }, insets = { top: 0, left: 0, bottom: 0 }) {
    const width = container.width - insets.left;
    const height = container.height - insets.top - insets.bottom;
    const scale = clampZoom(Math.min((width - FIT_PADDING * 2) / page.width, (height - FIT_PADDING * 2) / page.height));
    this.set(
      {
        scale,
        x: insets.left + (width - page.width * scale) / 2,
        y: insets.top + (height - page.height * scale) / 2,
      },
      { fitted: true },
    );
  }

  /** Zoom keeping the given container point stationary. */
  zoomAt(point: { x: number; y: number }, nextScale: number) {
    const { scale, x, y } = this.view;
    const clamped = clampZoom(nextScale);
    const ratio = clamped / scale;
    this.set({ scale: clamped, x: point.x - (point.x - x) * ratio, y: point.y - (point.y - y) * ratio });
  }

  panBy(dx: number, dy: number) {
    this.set({ ...this.view, x: this.view.x + dx, y: this.view.y + dy });
  }

  private schedule() {
    if (this.frame || typeof window === "undefined") return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.stage) {
        this.stage.scale({ x: this.view.scale, y: this.view.scale });
        this.stage.position({ x: this.view.x, y: this.view.y });
        this.stage.batchDraw();
      }
      for (const listener of this.listeners) listener();
    });
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
