/**
 * The flyer document: a flat, ordered list of nodes (index = z-order) on a page of
 * fixed logical size. Stored as JSON in flyer_projects.canvas and rendered by Konva.
 */

export type FlyerFormat = "poster" | "square" | "story" | "landscape";

export type FontKey =
  | "sans"
  | "geometric"
  | "serif"
  | "elegant"
  | "dserif"
  | "display"
  | "heavy"
  | "condensed"
  | "grotesk"
  | "calligraphy"
  | "script";

export type FontWeight = 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface Shadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

/** How a layer mixes with what is below it (Photoshop's blend modes; CSS mix-blend-mode). */
export type BlendMode = "multiply" | "screen" | "overlay" | "soft-light" | "darken" | "lighten";

/**
 * Photo treatments a designer applies: black and white, a two-colour duotone, blur, a
 * darkening veil and film grain. Lengths are in document units.
 */
export interface PhotoEffects {
  tone?: "mono" | "duotone";
  /** Duotone shadows and highlights. */
  dark?: string;
  light?: string;
  blur?: number;
  /** 0–1: darkens towards black. */
  dim?: number;
  /** 0–1: film grain strength. */
  grain?: number;
}

export interface Stroke {
  color: string;
  width: number;
  dash?: number[];
}

interface NodeBase {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  locked?: boolean;
  hidden?: boolean;
  shadow?: Shadow;
  blend?: BlendMode;
}

export interface TextNode extends NodeBase {
  type: "text";
  text: string;
  font: FontKey;
  fontSize: number;
  fontWeight: FontWeight;
  italic?: boolean;
  uppercase?: boolean;
  fill: string;
  align: "left" | "center" | "right";
  width: number;
  lineHeight: number;
  letterSpacing: number;
  /** An outline; with fill "transparent" the text is drawn as outline only. */
  stroke?: { color: string; width: number };
}

/** A photo frame. The image is cover-cropped to the frame; an empty `src` is a drop slot. */
export interface ImageNode extends NodeBase {
  type: "image";
  src: string;
  width: number;
  height: number;
  cornerRadius: number;
  stroke?: Stroke;
  effects?: PhotoEffects;
  /**
   * A window into a larger picture: the photo is cover-fitted to this frame (page
   * coordinates) and the node shows the part beneath it — so a sharp strip lines up
   * exactly with the same photo blurred full-page behind it.
   */
  fitFrame?: { x: number; y: number; width: number; height: number };
  /** Attribution for stock photography (shown in the editor; required by Unsplash). */
  credit?: { name: string; url: string };
}

export interface ShapeNode extends NodeBase {
  type: "shape";
  shape: "rect" | "ellipse" | "arc";
  width: number;
  height: number;
  fill: string;
  /** Optional gradient (top → bottom, or left → right when horizontal); overrides `fill`. */
  gradient?: { from: string; to: string; horizontal?: boolean };
  cornerRadius: number;
  stroke?: Stroke;
  /** For `arc`: a ring segment inside the box. Angles in degrees, 0 = 12 o'clock, clockwise. */
  arc?: { start: number; sweep: number; thickness: number };
  /** A surface texture drawn over the fill (film grain / paper tooth). */
  texture?: "grain";
}

/** Vector artwork (icons, stars, brackets, blobs) as SVG path data in its own viewBox. */
export interface PathNode extends NodeBase {
  type: "path";
  paths: string[];
  viewBox: [number, number];
  width: number;
  height: number;
  fill: string | null;
  /** Stroke width is in viewBox units, so line weight scales with the shape. */
  stroke: { color: string; width: number } | null;
  /** Set when the path is an icon from lib/design/icons.json. */
  icon?: string;
}

export type FlyerNode = TextNode | ImageNode | ShapeNode | PathNode;

export interface FlyerDoc {
  version: 1;
  format: FlyerFormat;
  width: number;
  height: number;
  background: string;
  nodes: FlyerNode[];
}
