import type { FlyerNode, TextNode } from "./canvas/types";
import { measure, wrap } from "./metrics";

/** Shared page geometry for the decoration placer and the design lint. */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;

export function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

const area = (box: Box) => box.width * box.height;

/** Overlap as a share of the smaller box (0–1). */
export function overlapRatio(a: Box, b: Box) {
  const shared = intersect(a, b);
  return shared ? area(shared) / Math.max(1, Math.min(area(a), area(b))) : 0;
}

function styleOf(node: TextNode) {
  return { font: node.font, weight: node.fontWeight, size: node.fontSize, uppercase: node.uppercase, letterSpacing: node.letterSpacing };
}

export function textLines(node: TextNode) {
  return wrap(node.text, styleOf(node), node.width + 1);
}

export function textHeight(node: TextNode) {
  return textLines(node).length * node.fontSize * node.lineHeight;
}

/** Bounds of a box rotated about (x, y), as Konva rotates nodes. */
function rotated(x: number, y: number, local: Box, rotation: number): Box {
  if (!rotation) return { x: x + local.x, y: y + local.y, width: local.width, height: local.height };
  const t = (rotation * Math.PI) / 180;
  const corners = [
    [local.x, local.y],
    [local.x + local.width, local.y],
    [local.x, local.y + local.height],
    [local.x + local.width, local.y + local.height],
  ].map(([dx, dy]) => [x + dx! * Math.cos(t) - dy! * Math.sin(t), y + dx! * Math.sin(t) + dy! * Math.cos(t)]);
  const xs = corners.map((c) => c[0]!);
  const ys = corners.map((c) => c[1]!);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Axis-aligned bounds of a node's frame, rotation included. */
export function bounds(node: FlyerNode): Box {
  const height = node.type === "text" ? textHeight(node) : node.height;
  return rotated(node.x, node.y, { x: 0, y: 0, width: node.width, height }, node.rotation);
}

/** One box per rendered line, each measured and aligned — the tightest honest footprint. */
export function inkLines(node: TextNode): Box[] {
  const lineHeight = node.fontSize * node.lineHeight;
  return textLines(node).map((line, i) => {
    const width = Math.min(node.width, measure(line, styleOf(node)));
    const left = node.align === "center" ? (node.width - width) / 2 : node.align === "right" ? node.width - width : 0;
    return rotated(node.x, node.y, { x: left, y: i * lineHeight, width, height: lineHeight }, node.rotation);
  });
}

/**
 * Line boxes in a frame turned by `angle`. Nodes that share a rotation (a tilted headline
 * block) are axis-aligned there, so they can be compared exactly — their page-space boxes
 * grow with the tilt and would seem to overlap.
 */
export function inkLinesInFrame(node: TextNode, angle: number): Box[] {
  const t = (-angle * Math.PI) / 180;
  const ox = node.x * Math.cos(t) - node.y * Math.sin(t);
  const oy = node.x * Math.sin(t) + node.y * Math.cos(t);
  const lineHeight = node.fontSize * node.lineHeight;
  return textLines(node).map((line, i) => {
    const width = Math.min(node.width, measure(line, styleOf(node)));
    const left = node.align === "center" ? (node.width - width) / 2 : node.align === "right" ? node.width - width : 0;
    return { x: ox + left, y: oy + i * lineHeight, width, height: lineHeight };
  });
}

/**
 * Where a text node's glyphs actually are: each line measured and aligned inside the
 * box, so a short centred line in a wide box doesn't claim the whole width.
 */
export function inkBounds(node: TextNode): Box {
  const lines = textLines(node);
  const lineHeight = node.fontSize * node.lineHeight;
  const widths = lines.map((line) => Math.min(node.width, measure(line, styleOf(node))));
  const widest = Math.max(0, ...widths);
  const left = node.align === "center" ? (node.width - widest) / 2 : node.align === "right" ? node.width - widest : 0;
  return rotated(node.x, node.y, { x: left, y: 0, width: widest, height: lines.length * lineHeight }, node.rotation);
}
