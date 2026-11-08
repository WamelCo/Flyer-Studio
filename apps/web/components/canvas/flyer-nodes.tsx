"use client";

import type Konva from "konva";
import type { Context } from "konva/lib/Context";
import type { KonvaEventObject } from "konva/lib/Node";
import { Image as KonvaImage, Rect, Shape, Text } from "react-konva";

import { FONT_FAMILIES } from "@/lib/canvas/fonts";
import type { FlyerNode, ImageNode, PathNode, ShapeNode, TextNode } from "@flyer/core/canvas/types";
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
    />
  );
}

/** Centre-crop the source to the frame's aspect ratio (CSS `object-fit: cover`). */
function coverCrop(image: HTMLImageElement, width: number, height: number) {
  const frame = width / height;
  const source = image.naturalWidth / image.naturalHeight;
  if (source > frame) {
    const cropWidth = image.naturalHeight * frame;
    return { x: (image.naturalWidth - cropWidth) / 2, y: 0, width: cropWidth, height: image.naturalHeight };
  }
  const cropHeight = image.naturalWidth / frame;
  return { x: 0, y: (image.naturalHeight - cropHeight) / 2, width: image.naturalWidth, height: cropHeight };
}

function ImageView(props: NodeViewProps & { node: ImageNode }) {
  const { node } = props;
  const image = useImage(node.src);

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
      {...common(node, props)}
      image={image}
      width={node.width}
      height={node.height}
      crop={coverCrop(image, node.width, node.height)}
      cornerRadius={node.cornerRadius}
      {...strokeProps(node.stroke)}
    />
  );
}

function ShapeView(props: NodeViewProps & { node: ShapeNode }) {
  const { node } = props;
  const fill = node.gradient
    ? {
        fillLinearGradientStartPoint: { x: 0, y: 0 },
        fillLinearGradientEndPoint: { x: 0, y: node.height },
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
