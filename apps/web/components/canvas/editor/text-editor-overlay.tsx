"use client";

import type Konva from "konva";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { Viewport } from "@/components/canvas/editor/viewport";
import { FONT_FAMILIES } from "@/lib/canvas/fonts";
import type { TextNode } from "@flyer/core/canvas/types";

interface TextEditorOverlayProps {
  node: TextNode;
  stage: Konva.Stage;
  viewport: Viewport;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

/** Double-click editing: a textarea laid exactly over the Konva text, matching its type. */
export function TextEditorOverlay({ node, stage, viewport, onCommit, onCancel }: TextEditorOverlayProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(node.text);
  const done = useRef(false);

  const position = useCallback(() => {
    const element = ref.current;
    const target = stage.findOne(`#${node.id}`);
    if (!element || !target) return;
    const { x, y } = target.getAbsolutePosition();
    const scale = viewport.get().scale;
    element.style.transform = `translate(${x}px, ${y}px) rotate(${node.rotation}deg)`;
    element.style.width = `${node.width * scale}px`;
    element.style.fontSize = `${node.fontSize * scale}px`;
    element.style.letterSpacing = `${node.letterSpacing * scale}px`;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [node, stage, viewport]);

  useLayoutEffect(() => {
    position();
    ref.current?.focus();
    ref.current?.select();
    return viewport.subscribe(position);
  }, [position, viewport]);

  useLayoutEffect(position, [value, position]);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };

  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      rows={1}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") finish(false);
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) finish(true);
      }}
      spellCheck
      className="absolute left-0 top-0 z-10 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
      style={{
        transformOrigin: "top left",
        fontFamily: FONT_FAMILIES[node.font],
        fontWeight: node.fontWeight,
        fontStyle: node.italic ? "italic" : "normal",
        lineHeight: node.lineHeight,
        textAlign: node.align,
        textTransform: node.uppercase ? "uppercase" : "none",
        color: node.fill,
        caretColor: "var(--accent)",
        boxShadow: "0 0 0 1px var(--accent)",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
      }}
    />
  );
}
