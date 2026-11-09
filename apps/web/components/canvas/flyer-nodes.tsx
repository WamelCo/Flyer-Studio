"use client";

import Konva from "konva";
import type { Context } from "konva/lib/Context";
import type { Filter, KonvaEventObject } from "konva/lib/Node";
import { useEffect, useMemo, useRef } from "react";
import { Image as KonvaImage, Rect, Shape, Text } from "react-konva";

import { grainPattern, hasPixelEffects, sourceCrop, treatPixels } from "@flyer/design/canvas/effects";
import { FONT_FAMILIES } from "@/lib/canvas/fonts";
import type { FlyerNode, ImageNode, PathNode, ShapeNode, TextNode } from "@flyer/design/canvas/types";
import { useImage } from "@/lib/canvas/use-image";

export interface NodeHandlers {
  onSelect?: (id: string, event: KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragMove?: (id: string, node: Konva.Node) => void;
  onDragEnd?: (id: string, node: Konva.Node) => void;
  onTransformEnd?: (id: string, node: Konva.Node) => void;
  onDblClick?: (id: string) => void;
}

interface NodeViewProps extends NodeHandlers {
  node: FlyerNode;
  interactive?: boolean;
  /** Hidden while its text is being edited in the overlay textarea. */
  editing?: boolean;
}

export function fontStyle(node: Pick<TextNode, "italic" | "fontWeight">) {
  return `${node.italic ? "italic " : ""}${node.fontWeight}`;
}

function common(node: FlyerNode, props: NodeViewProps) {
  const { interactive, onSelect, onDragMove, onDragEnd, onTransformEnd, onDblClick } = props;
  return {
    id: node.id,
    name: "flyer-node",
    x: node.x,
    y: node.y,
    rotation: node.rotation,
    opacity: node.opacity,
    visible: !node.hidden && !props.editing,
    // Locked nodes let clicks fall through to the page (select them from Layers instead).
    listening: Boolean(interactive && !node.locked),
    perfectDrawEnabled: false,
    ...(node.blend && { globalCompositeOperation: node.blend }),
    draggable: interactive && !node.locked,
    ...(node.shadow && {
      shadowColor: node.shadow.color,
      shadowBlur: node.shadow.blur,
      shadowOffsetX: node.shadow.offsetX,
      shadowOffsetY: node.shadow.offsetY,
      shadowForStrokeEnabled: false,
    }),
    onMouseDown: interactive ? (event: KonvaEventObject<MouseEvent>) => onSelect?.(node.id, event) : undefined,
    onTap: interactive ? (event: KonvaEventObject<TouchEvent>) => onSelect?.(node.id, event) : undefined,
    onDragMove: interactive ? (event: KonvaEventObject<DragEvent>) => onDragMove?.(node.id, event.target) : undefined,
    onDragEnd: interactive ? (event: KonvaEventObject<DragEvent>) => onDragEnd?.(node.id, event.target) : undefined,
    onTransformEnd: interactive ? (event: KonvaEventObject<Event>) => onTransformEnd?.(node.id, event.target) : undefined,
    onDblClick: interactive ? () => onDblClick?.(node.id) : undefined,
    onDblTap: interactive ? () => onDblClick?.(node.id) : undefined,
  };
}

function strokeProps(stroke: ImageNode["stroke"] | ShapeNode["stroke"]) {
  return stroke ? { stroke: stroke.color, strokeWidth: stroke.width, dash: stroke.dash } : {};
}

function TextView(props: NodeViewProps & { node: TextNode }) {
  const { node } = props;
  return (
    <Text
      {...common(node, props)}
      text={node.uppercase ? node.text.toUpperCase() : node.text}
      fontFamily={FONT_FAMILIES[node.font]}
      fontSize={node.fontSize}
      fontStyle={fontStyle(node)}
      fill={node.fill}
      align={node.align}
      width={node.width}
      lineHeight={node.lineHeight}
      letterSpacing={node.letterSpacing}
      wrap="word"
      {...(node.stroke && { stroke: node.stroke.color, strokeWidth: node.stroke.width, fillEnabled: node.fill !== "transparent" })}
    />
  );
}

function ImageView(props: NodeViewProps & { node: ImageNode }) {
  const { node } = props;
  const image = useImage(node.src);
  const ref = useRef<Konva.Image>(null);
  const effects = node.effects;
  const key = JSON.stringify(effects ?? null);
  // Filters run on a cached bitmap: blur first, then tone, dim and grain in one pass.
  const filters = useMemo(() => {
    const list: Filter[] = [];
    if (effects?.blur) list.push(Konva.Filters.Blur);
    if (hasPixelEffects(effects)) list.push((data: ImageData) => treatPixels(data.data, effects!));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the effects' content
  }, [key]);
  // Blurred photos need no extra resolution; sharp treated ones stay crisp for 300 dpi export.
  const pixelRatio = effects?.blur ? 1 : 2;

  useEffect(() => {
    const shape = ref.current;
    if (!shape || !image) return;
    if (filters.length) shape.cache({ pixelRatio });
    else shape.clearCache();
    shape.getLayer()?.batchDraw();
  }, [image, filters, pixelRatio, node.width, node.height, node.x, node.y, node.fitFrame]);

  if (!node.src || !image) {
    // Empty photo slot (or still loading): a quiet frame the user can fill.
    return (
      <Rect
        {...common(node, props)}
        width={node.width}
        height={node.height}
        cornerRadius={node.cornerRadius}
        fill="rgba(128,128,128,0.18)"
        {...(node.stroke ? strokeProps(node.stroke) : { stroke: "rgba(128,128,128,0.45)", strokeWidth: 2, dash: [10, 8] })}
      />
    );
  }

  return (
    <KonvaImage
      ref={ref}
      {...common(node, props)}
      image={image}
      width={node.width}
      height={node.height}
      crop={sourceCrop({ width: image.naturalWidth, height: image.naturalHeight }, node)}
      cornerRadius={node.cornerRadius}
      {...strokeProps(node.stroke)}
      {...(filters.length && { filters, blurRadius: (effects?.blur ?? 0) * pixelRatio })}
    />
  );
}

function ShapeView(props: NodeViewProps & { node: ShapeNode }) {
  const { node } = props;
  const fill = node.gradient
    ? {
        fillLinearGradientStartPoint: { x: 0, y: 0 },
        fillLinearGradientEndPoint: node.gradient.horizontal ? { x: node.width, y: 0 } : { x: 0, y: node.height },
        fillLinearGradientColorStops: [0, node.gradient.from, 1, node.gradient.to],
      }
    : { fill: node.fill };

  if (node.shape === "ellipse" || node.shape === "arc") {
    const arc = node.arc;
    // Drawn inside its box so x/y mean top-left for every node type.
    return (
      <Shape
        {...common(node, props)}
        {...fill}
        {...strokeProps(node.stroke)}
        width={node.width}
        height={node.height}
        sceneFunc={(context, shape) => {
          const width = shape.width();
          const height = shape.height();
          context.beginPath();
          if (node.shape === "arc" && arc) {
            const radius = Math.min(width, height) / 2;
            const start = ((arc.start - 90) * Math.PI) / 180;
            const end = start + (arc.sweep * Math.PI) / 180;
            context.arc(width / 2, height / 2, radius, start, end, false);
            context.arc(width / 2, height / 2, Math.max(0, radius - arc.thickness), end, start, true);
          } else {
            context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
          }
          context.closePath();
          context.fillStrokeShape(shape);
        }}
      />
    );
  }

  if (node.texture === "grain") {
    return (
      <Rect
        {...common(node, props)}
        fillPatternImage={grainPattern() as unknown as HTMLImageElement}
        fillPatternRepeat="repeat"
        width={node.width}
        height={node.height}
        cornerRadius={node.cornerRadius}
      />
    );
  }

  return (
    <Rect
      {...common(node, props)}
      {...fill}
      {...strokeProps(node.stroke)}
      width={node.width}
      height={node.height}
      cornerRadius={node.cornerRadius}
    />
  );
}

const pathCache = new Map<string, Path2D>();
function path2d(data: string) {
  let path = pathCache.get(data);
  if (!path) {
    path = new Path2D(data);
    pathCache.set(data, path);
  }
  return path;
}

function PathView(props: NodeViewProps & { node: PathNode }) {
  const { node } = props;
  return (
    <Shape
      {...common(node, props)}
      width={node.width}
      height={node.height}
      sceneFunc={(context: Context, shape) => {
        const ctx = context._context as CanvasRenderingContext2D;
        const [viewWidth, viewHeight] = node.viewBox;
        ctx.save();
        ctx.scale(shape.width() / viewWidth, shape.height() / viewHeight);
        for (const data of node.paths) {
          const path = path2d(data);
          if (node.fill) {
            ctx.fillStyle = node.fill;
            ctx.fill(path);
          }
          if (node.stroke) {
            ctx.strokeStyle = node.stroke.color;
            ctx.lineWidth = node.stroke.width;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.stroke(path);
          }
        }
        ctx.restore();
      }}
      // The whole box is clickable: thin icon strokes are otherwise hard to hit.
      hitFunc={(context, shape) => {
        context.beginPath();
        context.rect(0, 0, shape.width(), shape.height());
        context.closePath();
        context.fillStrokeShape(shape);
      }}
    />
  );
}

export function NodeView(props: NodeViewProps) {
  switch (props.node.type) {
    case "text":
      return <TextView {...props} node={props.node} />;
    case "image":
      return <ImageView {...props} node={props.node} />;
    case "shape":
      return <ShapeView {...props} node={props.node} />;
    case "path":
      return <PathView {...props} node={props.node} />;
  }
}
