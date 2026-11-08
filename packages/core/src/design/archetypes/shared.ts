import type { FlyerNode } from "../../canvas/types";
import { textHeight, type Ctx } from "../engine";

/** Rotate everything added since `fromIndex` around a pivot (a tilted headline block). */
export function rotateGroup(ctx: Ctx, fromIndex: number, pivot: { x: number; y: number }, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  for (const node of ctx.nodes.slice(fromIndex) as FlyerNode[]) {
    const dx = node.x - pivot.x;
    const dy = node.y - pivot.y;
    node.x = Math.round(pivot.x + dx * cos - dy * sin);
    node.y = Math.round(pivot.y + dx * sin + dy * cos);
    node.rotation += degrees;
  }
}

/** Short, label-like strings (chips, tags) — anything longer reads as a sentence. */
export function isShort(value: string | null | undefined, max = 16): value is string {
  return Boolean(value && value.length <= max);
}

export function joinDetails(ctx: Ctx) {
  return ctx.copy.details.map((d) => d.text).join("  ·  ");
}

export function bodyHeight(ctx: Ctx, value: string | null, size: number, width: number, maxLines: number) {
  return value ? textHeight(value, ctx.type.body, size, width, maxLines) : 0;
}

export function socialLine(ctx: Ctx) {
  return ctx.copy.contact.social.slice(0, 3).join("   ");
}
