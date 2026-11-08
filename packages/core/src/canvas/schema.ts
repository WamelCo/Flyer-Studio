import { z } from "zod";

import type { FlyerDoc } from "./types";

const finite = z.number().finite();
const color = z.string().max(64);
const size = z.number().min(0.5).max(20000);

const shadow = z.object({ color, blur: z.number().min(0).max(500), offsetX: finite, offsetY: finite });
const stroke = z.object({ color, width: z.number().min(0).max(500), dash: z.array(z.number().min(0).max(2000)).max(8).optional() });

const base = {
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  x: finite,
  y: finite,
  rotation: finite,
  opacity: z.number().min(0).max(1),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  shadow: shadow.optional(),
};

const textNode = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string().max(2000),
  font: z.enum(["sans", "geometric", "serif", "elegant", "dserif", "display", "heavy", "condensed", "grotesk", "calligraphy", "script"]),
  fontSize: z.number().min(4).max(2000),
  fontWeight: z.union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900)]),
  italic: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  fill: color,
  align: z.enum(["left", "center", "right"]),
  width: size,
  lineHeight: z.number().min(0.5).max(4),
  letterSpacing: z.number().min(-200).max(400),
});

const imageNode = z.object({
  ...base,
  type: z.literal("image"),
  // "" is an empty photo slot; otherwise a URL (host allow-list enforced by the API).
  src: z.union([z.literal(""), z.string().url().max(2048)]),
  width: size,
  height: size,
  cornerRadius: z.number().min(0).max(10000),
  stroke: stroke.optional(),
  credit: z.object({ name: z.string().max(120), url: z.string().url().max(512) }).optional(),
});

const shapeNode = z.object({
  ...base,
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse", "arc"]),
  width: size,
  height: size,
  fill: color,
  gradient: z.object({ from: color, to: color }).optional(),
  cornerRadius: z.number().min(0).max(10000),
  stroke: stroke.optional(),
  arc: z.object({ start: finite, sweep: z.number().min(0).max(360), thickness: z.number().min(0).max(10000) }).optional(),
});

const pathNode = z.object({
  ...base,
  type: z.literal("path"),
  paths: z.array(z.string().max(8000)).min(1).max(24),
  viewBox: z.tuple([z.number().positive().max(10000), z.number().positive().max(10000)]),
  width: size,
  height: size,
  fill: color.nullable(),
  stroke: z.object({ color, width: z.number().min(0).max(1000) }).nullable(),
  icon: z.string().max(40).optional(),
});

export const flyerDocSchema: z.ZodType<FlyerDoc> = z.object({
  version: z.literal(1),
  format: z.enum(["poster", "square", "story", "landscape"]),
  width: z.number().min(1).max(20000),
  height: z.number().min(1).max(20000),
  background: color,
  nodes: z.array(z.discriminatedUnion("type", [textNode, imageNode, shapeNode, pathNode])).max(400),
}) as z.ZodType<FlyerDoc>;
