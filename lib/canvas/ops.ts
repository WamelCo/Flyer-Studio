import { nodeId } from "@/lib/canvas/ids";
import { FONT_LABELS } from "@/lib/canvas/fonts";
import type { FlyerDoc, FlyerNode, FontKey, ImageNode, PathNode, ShapeNode, TextNode } from "@/lib/canvas/types";
import ICONS from "@/lib/design/icons.json";

/** Pure document operations. Every edit produces a new doc so history is just snapshots. */

export function updateNode<T extends FlyerNode>(doc: FlyerDoc, id: string, patch: Partial<T>): FlyerDoc {
  return { ...doc, nodes: doc.nodes.map((node) => (node.id === id ? ({ ...node, ...patch } as FlyerNode) : node)) };
}

export function removeNode(doc: FlyerDoc, id: string): FlyerDoc {
  return { ...doc, nodes: doc.nodes.filter((node) => node.id !== id) };
}

export function addNode(doc: FlyerDoc, node: FlyerNode): FlyerDoc {
  return { ...doc, nodes: [...doc.nodes, node] };
}

export function duplicateNode(doc: FlyerDoc, id: string): { doc: FlyerDoc; id: string } | null {
  const index = doc.nodes.findIndex((node) => node.id === id);
  const source = doc.nodes[index];
  if (!source) return null;
  const offset = Math.round(Math.min(doc.width, doc.height) * 0.02);
  const copy = { ...source, id: nodeId(), name: `${source.name} copy`, x: source.x + offset, y: source.y + offset, locked: false };
  const nodes = [...doc.nodes];
  nodes.splice(index + 1, 0, copy);
  return { doc: { ...doc, nodes }, id: copy.id };
}

export type Arrange = "forward" | "backward" | "front" | "back";

export function arrangeNode(doc: FlyerDoc, id: string, direction: Arrange): FlyerDoc {
  const index = doc.nodes.findIndex((node) => node.id === id);
  if (index < 0) return doc;
  const nodes = [...doc.nodes];
  const [node] = nodes.splice(index, 1);
  const target =
    direction === "front"
      ? nodes.length
      : direction === "back"
        ? 0
        : Math.max(0, Math.min(nodes.length, index + (direction === "forward" ? 1 : -1)));
  nodes.splice(target, 0, node!);
  return { ...doc, nodes };
}

/** Reorder by an explicit top-to-bottom id list (Layers panel). */
export function reorderNodes(doc: FlyerDoc, topToBottomIds: string[]): FlyerDoc {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const nodes = [...topToBottomIds].reverse().flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return nodes.length === doc.nodes.length ? { ...doc, nodes } : doc;
}

// ── Factories ────────────────────────────────────────────────────────────────

export type TextPreset = "heading" | "subheading" | "body";

export function createText(doc: FlyerDoc, preset: TextPreset, font?: FontKey): TextNode {
  const u = Math.min(doc.width, doc.height) / 100;
  const sizes: Record<TextPreset, { fontSize: number; fontWeight: TextNode["fontWeight"]; font: FontKey; text: string }> = {
    heading: { fontSize: Math.round(10 * u), fontWeight: 700, font: "display", text: "Add a heading" },
    subheading: { fontSize: Math.round(5 * u), fontWeight: 600, font: "grotesk", text: "Add a subheading" },
    body: { fontSize: Math.round(3.2 * u), fontWeight: 400, font: "sans", text: "Add a little body text" },
  };
  const preset_ = sizes[preset];
  const width = Math.round(doc.width * 0.7);
  const chosen = font ?? preset_.font;
  return {
    id: nodeId(),
    type: "text",
    name: preset === "body" ? "Text" : FONT_LABELS[chosen],
    text: preset_.text,
    font: chosen,
    fontSize: preset_.fontSize,
    fontWeight: preset_.fontWeight,
    fill: doc.background.toLowerCase() === "#ffffff" ? "#1D1D1F" : "#FFFFFF",
    align: "center",
    width,
    lineHeight: 1.15,
    letterSpacing: 0,
    x: Math.round((doc.width - width) / 2),
    y: Math.round(doc.height / 2 - preset_.fontSize / 2),
    rotation: 0,
    opacity: 1,
  };
}

export type ShapePreset = "rect" | "rounded" | "ellipse" | "line";

export function createShape(doc: FlyerDoc, preset: ShapePreset, fill = "#0071E3"): ShapeNode {
  const size = Math.round(Math.min(doc.width, doc.height) * 0.3);
  const line = preset === "line";
  const width = line ? Math.round(doc.width * 0.5) : size;
  const height = line ? Math.max(2, Math.round(size * 0.02)) : size;
  return {
    id: nodeId(),
    type: "shape",
    name: { rect: "Rectangle", rounded: "Rounded rectangle", ellipse: "Ellipse", line: "Line" }[preset],
    shape: preset === "ellipse" ? "ellipse" : "rect",
    width,
    height,
    fill,
    cornerRadius: preset === "rounded" ? Math.round(size * 0.12) : 0,
    x: Math.round((doc.width - width) / 2),
    y: Math.round((doc.height - height) / 2),
    rotation: 0,
    opacity: 1,
  };
}

export function createImage(doc: FlyerDoc, src: string, natural: { width: number; height: number }): ImageNode {
  const scale = Math.min((doc.width * 0.6) / natural.width, (doc.height * 0.6) / natural.height, 1);
  const width = Math.round(natural.width * scale);
  const height = Math.round(natural.height * scale);
  return {
    id: nodeId(),
    type: "image",
    name: "Image",
    src,
    width,
    height,
    cornerRadius: 0,
    x: Math.round((doc.width - width) / 2),
    y: Math.round((doc.height - height) / 2),
    rotation: 0,
    opacity: 1,
  };
}

/** A ring segment — the sweeping accent arc designers wrap around photos. */
export function createRing(doc: FlyerDoc, color = "#0071E3"): ShapeNode {
  const size = Math.round(Math.min(doc.width, doc.height) * 0.32);
  return {
    id: nodeId(),
    type: "shape",
    name: "Ring",
    shape: "arc",
    width: size,
    height: size,
    fill: color,
    cornerRadius: 0,
    arc: { start: 20, sweep: 220, thickness: Math.round(size * 0.08) },
    x: Math.round((doc.width - size) / 2),
    y: Math.round((doc.height - size) / 2),
    rotation: 0,
    opacity: 1,
  };
}

function starPath(points: number, depth: number) {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const r = i % 2 === 0 ? 50 : 50 * depth;
    d += `${i === 0 ? "M" : "L"}${(50 + r * Math.cos(angle)).toFixed(2)} ${(50 + r * Math.sin(angle)).toFixed(2)}`;
  }
  return `${d}Z`;
}

export function createStar(doc: FlyerDoc, kind: "star" | "burst", color = "#0071E3"): PathNode {
  const size = Math.round(Math.min(doc.width, doc.height) * 0.26);
  return {
    id: nodeId(),
    type: "path",
    name: kind === "star" ? "Star" : "Starburst",
    paths: [kind === "star" ? starPath(5, 0.45) : starPath(16, 0.8)],
    viewBox: [100, 100],
    width: size,
    height: size,
    fill: color,
    stroke: null,
    x: Math.round((doc.width - size) / 2),
    y: Math.round((doc.height - size) / 2),
    rotation: 0,
    opacity: 1,
  };
}

export type IconName = keyof typeof ICONS;
export const ICON_LIBRARY = Object.keys(ICONS) as IconName[];

export function createIcon(doc: FlyerDoc, icon: IconName, color = "#1D1D1F"): PathNode {
  const size = Math.round(Math.min(doc.width, doc.height) * 0.1);
  return {
    id: nodeId(),
    type: "path",
    name: `${icon} icon`,
    icon,
    paths: ICONS[icon],
    viewBox: [24, 24],
    width: size,
    height: size,
    fill: null,
    stroke: { color, width: 2 },
    x: Math.round((doc.width - size) / 2),
    y: Math.round((doc.height - size) / 2),
    rotation: 0,
    opacity: 1,
  };
}

export function describeNode(node: FlyerNode) {
  if (node.type === "text") return node.text.split("\n")[0]?.slice(0, 40) || node.name;
  return node.name;
}
