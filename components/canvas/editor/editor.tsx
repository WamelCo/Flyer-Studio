"use client";

import type Konva from "konva";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CanvasStage } from "@/components/canvas/editor/canvas-stage";
import { ContextToolbar } from "@/components/canvas/editor/context-toolbar";
import { ImagePanel, LayersPanel, ShapePanel, TextPanel } from "@/components/canvas/editor/panels";
import { TextEditorOverlay } from "@/components/canvas/editor/text-editor-overlay";
import { ToolPanel, ToolRail, ToolTabBar, TOOLS, type Tool } from "@/components/canvas/editor/tool-rail";
import { TopBar } from "@/components/canvas/editor/top-bar";
import { useAutosave } from "@/components/canvas/editor/use-autosave";
import { useEditorState } from "@/components/canvas/editor/use-editor-state";
import { Viewport } from "@/components/canvas/editor/viewport";
import { ExportButton } from "@/components/export/export-button";
import { useViewer } from "@/components/providers/viewer-provider";
import { apiFetch } from "@/lib/api/client";
import { loadFonts } from "@/lib/canvas/fonts";
import { addNode, arrangeNode, duplicateNode, removeNode, updateNode, type Arrange } from "@/lib/canvas/ops";
import { saveThumbnail } from "@/lib/canvas/thumbnail";
import type { FlyerDoc, FlyerNode } from "@/lib/canvas/types";
import { useElementSize } from "@/lib/use-element-size";

const BAR_HEIGHT = 52;
const RAIL_INSET = 80;
const TAB_BAR_HEIGHT = 56;
const NUDGE = 1;
const NUDGE_LARGE = 10;

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export interface EditorProject {
  id: string;
  title: string;
  doc: FlyerDoc;
  /** The server copy, when a newer local draft was restored. */
  savedDoc: FlyerDoc;
  artwork: string[];
}

export default function Editor({ project }: { project: EditorProject }) {
  const router = useRouter();
  const { viewer } = useViewer();
  const editor = useEditorState(project.doc);
  const { doc, selected, selectedId, commit, select, undo, redo } = editor;

  const viewport = useMemo(() => new Viewport(), []);
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const pageShadowRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<Konva.Group | null>(null);
  const [stage, setStage] = useState<Konva.Stage | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState(project.title);
  const [fontsReady, setFontsReady] = useState(false);
  const interactionListeners = useRef(new Set<() => void>());
  const spaceDown = useRef(false);

  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  const onSaved = useCallback(
    (saved: FlyerDoc) => {
      if (pageRef.current) {
        saveThumbnail(pageRef.current, saved, { userId: viewer.id, projectId: project.id }).catch(() => undefined);
      }
    },
    [project.id, viewer.id],
  );

  const autosave = useAutosave({ projectId: project.id, doc, initialSavedDoc: project.savedDoc, onSaved });
  const { saveNow } = autosave;

  // A restored local draft is persisted promptly rather than waiting for the 30s window.
  useEffect(() => {
    if (project.doc !== project.savedDoc) {
      const timer = window.setTimeout(() => void saveNow(), 1500);
      return () => window.clearTimeout(timer);
    }
  }, [project, saveNow]);

  useEffect(() => {
    let cancelled = false;
    loadFonts().then(() => !cancelled && setFontsReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Viewport ────────────────────────────────────────────────────────────
  const insets = useCallback(
    () => (window.matchMedia("(min-width: 768px)").matches ? { top: BAR_HEIGHT, left: RAIL_INSET, bottom: 0 } : { top: BAR_HEIGHT, left: 0, bottom: TAB_BAR_HEIGHT }),
    [],
  );

  const fit = useCallback(() => {
    if (size.width && size.height) viewport.fit(size, docRef.current, insets());
  }, [size, viewport, insets]);

  useEffect(() => {
    if (viewport.fitted) fit();
  }, [fit, viewport]);

  // Page backdrop (solid, shadowed) follows the viewport without React renders.
  useEffect(() => {
    const apply = () => {
      const element = pageShadowRef.current;
      if (!element) return;
      const { scale, x, y } = viewport.get();
      element.style.transform = `translate(${x}px, ${y}px)`;
      element.style.width = `${docRef.current.width * scale}px`;
      element.style.height = `${docRef.current.height * scale}px`;
    };
    apply();
    return viewport.subscribe(apply);
  }, [viewport]);

  const zoomBy = useCallback(
    (factor: number) => viewport.zoomAt({ x: size.width / 2, y: size.height / 2 }, viewport.get().scale * factor),
    [viewport, size],
  );

  // Wheel: pinch / ⌘-scroll zooms around the pointer, plain scroll pans. Space-drag pans.
  useEffect(() => {
    const element = document.getElementById("editor-canvas");
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        viewport.zoomAt(point, viewport.get().scale * Math.exp(-event.deltaY * 0.01));
      } else {
        viewport.panBy(-event.deltaX, -event.deltaY);
      }
    };

    let panFrom: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (spaceDown.current || event.button === 1) {
        event.stopPropagation();
        event.preventDefault();
        panFrom = { x: event.clientX, y: event.clientY };
        element.setPointerCapture(event.pointerId);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!panFrom) return;
      viewport.panBy(event.clientX - panFrom.x, event.clientY - panFrom.y);
      panFrom = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = () => {
      panFrom = null;
    };

    // Two-finger pinch on touch screens.
    let pinch: { distance: number; center: { x: number; y: number } } | null = null;
    const touchState = (touches: TouchList) => {
      const [a, b] = [touches[0]!, touches[1]!];
      const bounds = element.getBoundingClientRect();
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        center: { x: (a.clientX + b.clientX) / 2 - bounds.left, y: (a.clientY + b.clientY) / 2 - bounds.top },
      };
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        event.stopPropagation();
        pinch = touchState(event.touches);
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      const next = touchState(event.touches);
      viewport.panBy(next.center.x - pinch.center.x, next.center.y - pinch.center.y);
      viewport.zoomAt(next.center, viewport.get().scale * (next.distance / pinch.distance));
      pinch = next;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("pointerdown", onPointerDown, { capture: true });
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    element.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    element.addEventListener("touchend", onTouchEnd);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onPointerDown, { capture: true });
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("touchstart", onTouchStart, { capture: true });
      element.removeEventListener("touchmove", onTouchMove, { capture: true });
      element.removeEventListener("touchend", onTouchEnd);
    };
  }, [viewport, fontsReady]);

  useEffect(() => () => viewport.dispose(), [viewport]);

  // ── Document actions ────────────────────────────────────────────────────
  const patchSelected = useCallback(
    (patch: Partial<FlyerNode>, coalesce?: string) => {
      if (selectedId) commit(updateNode(docRef.current, selectedId, patch), { coalesce });
    },
    [commit, selectedId],
  );

  const add = useCallback(
    (node: FlyerNode) => {
      commit(addNode(docRef.current, node), { select: node.id });
      if (!window.matchMedia("(min-width: 768px)").matches) setTool(null);
    },
    [commit],
  );

  const remove = useCallback(() => {
    if (selectedId) commit(removeNode(docRef.current, selectedId), { select: null });
  }, [commit, selectedId]);

  const duplicate = useCallback(() => {
    if (!selectedId) return;
    const result = duplicateNode(docRef.current, selectedId);
    if (result) commit(result.doc, { select: result.id });
  }, [commit, selectedId]);

  const arrange = useCallback(
    (direction: Arrange) => {
      if (selectedId) commit(arrangeNode(docRef.current, selectedId, direction));
    },
    [commit, selectedId],
  );

  const commitText = useCallback(
    (text: string) => {
      const id = editingId;
      setEditingId(null);
      if (!id) return;
      if (text.trim() === "") commit(removeNode(docRef.current, id), { select: null });
      else commit(updateNode(docRef.current, id, { text }));
    },
    [commit, editingId],
  );

  const rename = useCallback(
    (next: string) => {
      setTitle(next);
      apiFetch(`/api/projects/${project.id}`, { method: "PATCH", json: { title: next } }).catch(() => setTitle(project.title));
    },
    [project.id, project.title],
  );

  const back = useCallback(async () => {
    if (autosave.isDirty()) await autosave.saveNow().catch(() => undefined);
    router.push("/projects");
  }, [autosave, router]);

  const onPageReady = useCallback((page: Konva.Group, konvaStage: Konva.Stage) => {
    pageRef.current = page;
    setStage(konvaStage);
  }, []);

  const notifyInteraction = useCallback(() => {
    for (const listener of interactionListeners.current) listener();
  }, []);

  const subscribeInteraction = useCallback((listener: () => void) => {
    interactionListeners.current.add(listener);
    return () => {
      interactionListeners.current.delete(listener);
    };
  }, []);

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === " " && !isTyping(event.target)) {
        spaceDown.current = true;
        document.body.style.cursor = "grab";
      }
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void autosave.saveNow();
        return;
      }
      if (isTyping(event.target)) return;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (mod && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        zoomBy(1.25);
      } else if (mod && event.key === "-") {
        event.preventDefault();
        zoomBy(1 / 1.25);
      } else if (mod && event.key === "0") {
        event.preventDefault();
        fit();
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicate();
      } else if (mod && event.key === "]") {
        arrange(event.shiftKey ? "front" : "forward");
      } else if (mod && event.key === "[") {
        arrange(event.shiftKey ? "back" : "backward");
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedId) {
          event.preventDefault();
          remove();
        }
      } else if (event.key === "Escape") {
        if (tool) setTool(null);
        else select(null);
      } else if (event.key === "Enter" && selected?.type === "text" && !selected.locked) {
        event.preventDefault();
        setEditingId(selected.id);
      } else if (event.key.startsWith("Arrow") && selected && !selected.locked) {
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        patchSelected({ x: selected.x + dx, y: selected.y + dy }, `nudge:${selected.id}`);
      } else if (!mod && !event.altKey) {
        const shortcut = TOOLS.find((candidate) => candidate.shortcut.toLowerCase() === event.key.toLowerCase());
        if (shortcut) setTool((current) => (current === shortcut.id ? null : shortcut.id));
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") {
        spaceDown.current = false;
        document.body.style.cursor = "";
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [arrange, autosave, duplicate, fit, patchSelected, redo, remove, select, selected, selectedId, tool, undo, zoomBy]);

  const editingNode = editingId ? doc.nodes.find((node) => node.id === editingId) : null;
  const getPage = () => pageRef.current;

  return (
    <div className="fixed inset-0 overflow-hidden bg-base">
      <div id="editor-canvas" ref={containerRef} className="absolute inset-0 touch-none">
        {/* The page is content: solid, shadowed, never glass. */}
        <div
          ref={pageShadowRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 origin-top-left shadow-page"
          style={{ background: doc.background, willChange: "transform" }}
        />
        {fontsReady && size.width > 0 && (
          <CanvasStage
            doc={doc}
            selectedId={selectedId}
            editingId={editingId}
            viewport={viewport}
            size={size}
            onSelect={select}
            onChange={commit}
            onEditText={setEditingId}
            onInteraction={notifyInteraction}
            onPageReady={onPageReady}
          />
        )}
        {stage && editingNode?.type === "text" && (
          <TextEditorOverlay
            key={editingNode.id}
            node={editingNode}
            stage={stage}
            viewport={viewport}
            onCommit={commitText}
            onCancel={() => setEditingId(null)}
          />
        )}
        {stage && selected && !selected.hidden && !editingId && (
          <ContextToolbar
            key={selected.id}
            node={selected}
            stage={stage}
            viewport={viewport}
            subscribeInteraction={subscribeInteraction}
            topInset={BAR_HEIGHT}
            onPatch={patchSelected}
            onArrange={arrange}
            onDuplicate={duplicate}
            onDelete={remove}
            onReplacePhoto={() => setTool("image")}
          />
        )}
      </div>

      <TopBar
        title={title}
        onRename={rename}
        onBack={() => void back()}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUndo={undo}
        onRedo={redo}
        viewport={viewport}
        onZoom={zoomBy}
        onFit={fit}
        saveStatus={autosave.status}
        exportSlot={<ExportButton projectId={project.id} title={title} doc={doc} getPage={getPage} />}
      />

      <ToolRail active={tool} onToggle={(next) => setTool((current) => (current === next ? null : next))} />
      <ToolPanel tool={tool} onClose={() => setTool(null)}>
        {tool === "text" && <TextPanel doc={doc} onAdd={add} />}
        {tool === "image" && (
          <ImagePanel
            doc={doc}
            onAdd={add}
            userId={viewer.id}
            artwork={project.artwork}
            selectedImage={selected?.type === "image" ? selected : null}
            onReplace={(src, credit) => patchSelected({ src, credit })}
          />
        )}
        {tool === "shape" && <ShapePanel doc={doc} onAdd={add} />}
        {tool === "layers" && <LayersPanel doc={doc} selectedId={selectedId} onSelect={select} onCommit={(next, coalesce) => commit(next, { coalesce })} />}
      </ToolPanel>
      <ToolTabBar active={tool} onToggle={(next) => setTool((current) => (current === next ? null : next))} />

      {/* Mobile: export floats as a capsule above the tab bar. */}
      <div className="fixed bottom-20 right-4 z-30 md:hidden">
        <ExportButton projectId={project.id} title={title} doc={doc} getPage={getPage} variant="capsule" />
      </div>
    </div>
  );
}
