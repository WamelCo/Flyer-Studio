"use client";

import Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCallback, useEffect, useRef } from "react";
import { Group, Layer, Rect, Stage, Transformer } from "react-konva";

import type { Viewport } from "@/components/canvas/editor/viewport";
import { NodeView } from "@/components/canvas/flyer-nodes";
import { updateNode } from "@/lib/canvas/ops";
import type { FlyerDoc, FlyerNode } from "@flyer/design/canvas/types";

const SNAP_PX = 6;
const ALL_ANCHORS = ["top-left", "top-center", "top-right", "middle-right", "middle-left", "bottom-left", "bottom-center", "bottom-right"];
const ACCENT = "#0071E3";

interface CanvasStageProps {
  doc: FlyerDoc;
  selectedId: string | null;
  editingId: string | null;
  viewport: Viewport;
  size: { width: number; height: number };
  onSelect: (id: string | null) => void;
  onChange: (doc: FlyerDoc) => void;
  onEditText: (id: string) => void;
  /** Fired on every drag/transform frame so DOM overlays can follow the node. */
  onInteraction: () => void;
  onPageReady: (page: Konva.Group, stage: Konva.Stage) => void;
}

export function CanvasStage({
  doc,
  selectedId,
  editingId,
  viewport,
  size,
  onSelect,
  onChange,
  onEditText,
  onInteraction,
  onPageReady,
}: CanvasStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const pageRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const guidesRef = useRef<Konva.Group>(null);
  const docRef = useRef(doc);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    viewport.attach(stageRef.current);
    if (pageRef.current && stageRef.current) onPageReady(pageRef.current, stageRef.current);
    return () => viewport.attach(null);
  }, [viewport, onPageReady]);

  // Keep the transformer attached to the selected node, with anchors suited to its type.
  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const model = doc.nodes.find((node) => node.id === selectedId);
    const target = model && !model.locked && !model.hidden && model.id !== editingId ? stage.findOne(`#${model.id}`) : null;

    if (!model || !target) {
      transformer.nodes([]);
    } else {
      transformer.nodes([target]);
      transformer.enabledAnchors(
        model.type === "text"
          ? ["middle-left", "middle-right"]
          : model.type === "image" || (model.type === "path" && model.icon)
            ? ["top-left", "top-right", "bottom-left", "bottom-right"]
            : ALL_ANCHORS,
      );
      // Photos and icons keep their proportions; text, shapes and vectors stretch freely.
      transformer.keepRatio(model.type === "image" || (model.type === "path" && Boolean(model.icon)));
    }
    transformer.getLayer()?.batchDraw();
  }, [doc, selectedId, editingId]);

  const clearGuides = useCallback(() => {
    guidesRef.current?.destroyChildren();
    guidesRef.current?.getLayer()?.batchDraw();
  }, []);

  /** Snap edges and centres to the page's edges and centre lines, drawing hairline guides. */
  const snap = useCallback(
    (node: Konva.Node) => {
      const page = pageRef.current;
      const guides = guidesRef.current;
      if (!page || !guides) return;
      const { width: W, height: H } = docRef.current;
      const threshold = SNAP_PX / viewport.get().scale;
      const rect = node.getClientRect({ relativeTo: page, skipShadow: true });
      guides.destroyChildren();

      const axes = [
        { targets: [0, W / 2, W], edges: [rect.x, rect.x + rect.width / 2, rect.x + rect.width], vertical: true },
        { targets: [0, H / 2, H], edges: [rect.y, rect.y + rect.height / 2, rect.y + rect.height], vertical: false },
      ];

      for (const axis of axes) {
        let best: { delta: number; target: number } | null = null;
        for (const target of axis.targets) {
          for (const edge of axis.edges) {
            const delta = target - edge;
            if (Math.abs(delta) < threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target };
          }
        }
        if (!best) continue;
        if (axis.vertical) node.x(node.x() + best.delta);
        else node.y(node.y() + best.delta);
        guides.add(
          new Konva.Line({
            points: axis.vertical ? [best.target, 0, best.target, H] : [0, best.target, W, best.target],
            stroke: ACCENT,
            strokeWidth: 1 / viewport.get().scale,
            listening: false,
          }),
        );
      }
      guides.getLayer()?.batchDraw();
    },
    [viewport],
  );

  const handleSelect = useCallback(
    (id: string, event: KonvaEventObject<MouseEvent | TouchEvent>) => {
      event.cancelBubble = true;
      onSelect(id);
    },
    [onSelect],
  );

  const handleDragMove = useCallback(
    (_id: string, node: Konva.Node) => {
      snap(node);
      onInteraction();
    },
    [snap, onInteraction],
  );

  const handleDragEnd = useCallback(
    (id: string, node: Konva.Node) => {
      clearGuides();
      onChange(updateNode(docRef.current, id, { x: Math.round(node.x()), y: Math.round(node.y()) }));
    },
    [clearGuides, onChange],
  );

  const handleTransformEnd = useCallback(
    (id: string, node: Konva.Node) => {
      const model = docRef.current.nodes.find((candidate) => candidate.id === id);
      if (!model) return;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scale({ x: 1, y: 1 });
      const patch: Partial<FlyerNode> = { x: Math.round(node.x()), y: Math.round(node.y()), rotation: node.rotation() };
      if (model.type === "text") {
        Object.assign(patch, { width: Math.max(20, Math.round(node.width() * scaleX)) });
      } else {
        Object.assign(patch, {
          width: Math.max(4, Math.round(node.width() * scaleX)),
          height: Math.max(4, Math.round(node.height() * scaleY)),
        });
      }
      onChange(updateNode(docRef.current, id, patch));
    },
    [onChange],
  );

  // Text reflows live while its width handles move, instead of stretching glyphs.
  const handleTransform = useCallback(() => {
    const node = transformerRef.current?.nodes()[0];
    if (node instanceof Konva.Text) {
      node.setAttrs({ width: Math.max(20, node.width() * node.scaleX()), scaleX: 1, scaleY: 1 });
    }
    onInteraction();
  }, [onInteraction]);

  const handleStagePointerDown = useCallback(
    (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
      const target = event.target;
      if (target === target.getStage() || target.name() === "page-background") onSelect(null);
    },
    [onSelect],
  );

  return (
    <Stage
      ref={stageRef}
      width={size.width}
      height={size.height}
      onMouseDown={handleStagePointerDown}
      onTouchStart={handleStagePointerDown}
    >
      <Layer>
        <Group ref={pageRef} clipX={0} clipY={0} clipWidth={doc.width} clipHeight={doc.height}>
          <Rect name="page-background" width={doc.width} height={doc.height} fill={doc.background} perfectDrawEnabled={false} />
          {doc.nodes.map((node) => (
            <NodeView
              key={node.id}
              node={node}
              interactive
              editing={node.id === editingId}
              onSelect={handleSelect}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onTransformEnd={handleTransformEnd}
              onDblClick={(id) => node.type === "text" && onEditText(id)}
            />
          ))}
        </Group>
      </Layer>
      <Layer>
        <Group ref={guidesRef} listening={false} />
        <Transformer
          ref={transformerRef}
          rotateEnabled
          flipEnabled={false}
          borderStroke={ACCENT}
          borderStrokeWidth={1.5}
          anchorStroke={ACCENT}
          anchorFill="#FFFFFF"
          anchorSize={10}
          anchorCornerRadius={5}
          rotateAnchorOffset={28}
          padding={2}
          ignoreStroke
          onTransform={handleTransform}
          onTransformEnd={clearGuides}
          boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox)}
        />
      </Layer>
    </Stage>
  );
}
