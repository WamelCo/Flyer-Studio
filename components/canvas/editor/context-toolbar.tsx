"use client";

import { motion } from "framer-motion";
import type Konva from "konva";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BringToFront,
  CaseUpper,
  Copy,
  ImagePlus,
  Italic,
  Lock,
  Minus,
  Plus,
  SendToBack,
  Trash2,
  Unlock,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

import type { Viewport } from "@/components/canvas/editor/viewport";
import { Tooltip } from "@/components/ui/tooltip";
import { FONT_KEYS, FONT_LABELS } from "@/lib/canvas/fonts";
import type { Arrange } from "@/lib/canvas/ops";
import type { FlyerNode, TextNode } from "@/lib/canvas/types";
import { sheetVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Clears the transformer's rotate handle (28px offset + anchor) above the selection.
const GAP = 48;
const GAP_BELOW = 12;
const EDGE = 8;

function ToolButton({
  label,
  icon: Icon,
  onClick,
  pressed,
  danger,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  pressed?: boolean;
  danger?: boolean;
}) {
  return (
    <Tooltip content={label} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className={cn(
          "focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-button",
          pressed ? "bg-accent-soft text-accent-text" : danger ? "text-danger hover:bg-fill" : "text-fg hover:bg-fill",
        )}
      >
        <Icon className="size-4" />
      </button>
    </Tooltip>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-separator" />;
}

function ColorSwatch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  // <input type="color"> only accepts #rrggbb; rgba fills show as their nearest hex.
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  return (
    <Tooltip content={label} side="top">
      <label className="focus-within:shadow-focus relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-button hover:bg-fill">
        <span className="size-5 rounded-full shadow-card" style={{ background: value }} />
        <input
          type="color"
          aria-label={label}
          value={hex}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </Tooltip>
  );
}

function Stepper({ value, onChange, label, step = 1, min = 1 }: { value: number; onChange: (value: number) => void; label: string; step?: number; min?: number }) {
  return (
    <div className="flex items-center" role="group" aria-label={label}>
      <ToolButton label={`Decrease ${label.toLowerCase()}`} icon={Minus} onClick={() => onChange(Math.max(min, value - step))} />
      <input
        aria-label={label}
        inputMode="numeric"
        value={Math.round(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next >= min) onChange(next);
        }}
        className="focus-ring h-8 w-12 rounded-button bg-transparent text-center text-callout tabular-nums text-fg hover:bg-fill"
      />
      <ToolButton label={`Increase ${label.toLowerCase()}`} icon={Plus} onClick={() => onChange(value + step)} />
    </div>
  );
}

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;
const NEXT_ALIGN = { left: "center", center: "right", right: "left" } as const;

interface ContextToolbarProps {
  node: FlyerNode;
  stage: Konva.Stage;
  viewport: Viewport;
  /** Fires on drag/transform frames so the toolbar can follow the node. */
  subscribeInteraction: (listener: () => void) => () => void;
  topInset: number;
  onPatch: (patch: Partial<FlyerNode>, coalesce?: string) => void;
  onArrange: (direction: Arrange) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Opens the Image panel so the next pick fills this frame. */
  onReplacePhoto: () => void;
}

/** Floats above the selected object. There is no permanent inspector. */
export function ContextToolbar({
  node,
  stage,
  viewport,
  subscribeInteraction,
  topInset,
  onPatch,
  onArrange,
  onDuplicate,
  onDelete,
  onReplacePhoto,
}: ContextToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);

  const position = useCallback(() => {
    const element = ref.current;
    const target = stage.findOne(`#${node.id}`);
    if (!element || !target) return;
    const rect = target.getClientRect({ skipShadow: true });
    const { offsetWidth: width, offsetHeight: height } = element;
    let top = rect.y - height - GAP;
    if (top < topInset + EDGE) top = rect.y + rect.height + GAP_BELOW;
    top = Math.min(top, stage.height() - height - EDGE);
    const left = Math.min(Math.max(EDGE, rect.x + rect.width / 2 - width / 2), stage.width() - width - EDGE);
    element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }, [node.id, stage, topInset]);

  useLayoutEffect(() => {
    position();
    // Drag/transform events can fire faster than frames; reposition at most once per frame.
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        position();
      });
    };
    const offViewport = viewport.subscribe(position);
    const offInteraction = subscribeInteraction(schedule);
    return () => {
      cancelAnimationFrame(frame);
      offViewport();
      offInteraction();
    };
  }, [position, viewport, subscribeInteraction, node]);

  let controls: ReactNode;
  if (node.locked) {
    controls = <ToolButton label="Unlock" icon={Unlock} onClick={() => onPatch({ locked: false })} />;
  } else {
    const text = node.type === "text" ? (node as TextNode) : null;
    const AlignIcon = text ? ALIGN_ICONS[text.align] : AlignLeft;
    controls = (
      <>
        {text && (
          <>
            <select
              aria-label="Font"
              value={text.font}
              onChange={(event) => onPatch({ font: event.target.value as TextNode["font"] })}
              className="focus-ring h-8 shrink-0 rounded-button bg-transparent px-2 text-callout text-fg hover:bg-fill"
            >
              {FONT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {FONT_LABELS[key]}
                </option>
              ))}
            </select>
            <Stepper label="Font size" value={text.fontSize} step={2} min={6} onChange={(fontSize) => onPatch({ fontSize }, `size:${node.id}`)} />
            <Divider />
            <ToolButton label="Bold" icon={Bold} pressed={text.fontWeight >= 600} onClick={() => onPatch({ fontWeight: text.fontWeight >= 600 ? 400 : 700 })} />
            <ToolButton label="Italic" icon={Italic} pressed={Boolean(text.italic)} onClick={() => onPatch({ italic: !text.italic })} />
            <ToolButton label="Uppercase" icon={CaseUpper} pressed={Boolean(text.uppercase)} onClick={() => onPatch({ uppercase: !text.uppercase })} />
            <ToolButton label={`Align ${text.align}`} icon={AlignIcon} onClick={() => onPatch({ align: NEXT_ALIGN[text.align] })} />
            <ColorSwatch label="Text colour" value={text.fill} onChange={(fill) => onPatch({ fill }, `fill:${node.id}`)} />
          </>
        )}
        {node.type === "shape" && (
          <>
            <ColorSwatch label="Fill" value={node.gradient ? node.gradient.to : node.fill} onChange={(fill) => onPatch({ fill, gradient: undefined }, `fill:${node.id}`)} />
            {node.shape === "rect" && (
              <Stepper label="Corner radius" value={node.cornerRadius} step={4} min={0} onChange={(cornerRadius) => onPatch({ cornerRadius }, `radius:${node.id}`)} />
            )}
          </>
        )}
        {node.type === "image" && (
          <>
            <ToolButton label={node.src ? "Replace photo" : "Add photo"} icon={ImagePlus} onClick={onReplacePhoto} />
            <Stepper label="Corner radius" value={node.cornerRadius} step={4} min={0} onChange={(cornerRadius) => onPatch({ cornerRadius }, `radius:${node.id}`)} />
            {node.credit && (
              <a
                href={node.credit.url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring shrink-0 truncate rounded-button px-2 text-caption text-fg-secondary hover:text-fg"
                style={{ maxWidth: 160 }}
              >
                Photo: {node.credit.name}
              </a>
            )}
          </>
        )}
        {node.type === "path" && (
          <ColorSwatch
            label={node.icon ? "Icon colour" : "Colour"}
            value={node.fill ?? node.stroke?.color ?? "#000000"}
            onChange={(color) =>
              onPatch(node.fill ? { fill: color } : { stroke: { color, width: node.stroke?.width ?? 2 } }, `fill:${node.id}`)
            }
          />
        )}
        {node.type === "shape" && node.shape === "arc" && node.arc && (
          <Stepper
            label="Arc length"
            value={node.arc.sweep}
            step={15}
            min={15}
            onChange={(sweep) => onPatch({ arc: { ...node.arc!, sweep: Math.min(360, sweep) } }, `arc:${node.id}`)}
          />
        )}
        <Divider />
        <ToolButton label="Bring forward" icon={BringToFront} onClick={() => onArrange("forward")} />
        <ToolButton label="Send backward" icon={SendToBack} onClick={() => onArrange("backward")} />
        <ToolButton label="Duplicate" icon={Copy} onClick={onDuplicate} />
        <ToolButton label="Lock" icon={Lock} onClick={() => onPatch({ locked: true })} />
        <ToolButton label="Delete" icon={Trash2} danger onClick={onDelete} />
      </>
    );
  }

  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-20" style={{ willChange: "transform" }}>
      <motion.div
        role="toolbar"
        aria-label={`${node.name} options`}
        variants={sheetVariants}
        initial="initial"
        animate="animate"
        className="material pointer-events-auto flex max-w-[calc(100vw-16px)] items-center gap-1 overflow-x-auto rounded-control p-1 shadow-float"
      >
        {controls}
      </motion.div>
    </div>
  );
}
