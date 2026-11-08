import type { CSSProperties } from "react";

import { FONT_FAMILIES } from "@/lib/canvas/fonts";
import type { FlyerDoc, FlyerNode } from "@flyer/core/canvas/types";
import { cn } from "@/lib/utils";

/**
 * DOM/SVG rendering of a flyer document for the marketing demo — the same documents
 * the layout engine produces, without shipping Konva on the landing page. Sizes are in
 * container units, so it scales crisply at any width.
 */
export function HtmlFlyer({ doc, className }: { doc: FlyerDoc; className?: string }) {
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  const cq = (value: number) => `${(value / doc.width) * 100}cqw`;

  const box = (node: FlyerNode, width: number, height?: number): CSSProperties => ({
    position: "absolute",
    left: pct(node.x, doc.width),
    top: pct(node.y, doc.height),
    width: pct(width, doc.width),
    ...(height !== undefined && { height: pct(height, doc.height) }),
    opacity: node.opacity,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: "top left",
    display: node.hidden ? "none" : undefined,
    filter: node.shadow ? `drop-shadow(0 ${cq(node.shadow.offsetY)} ${cq(node.shadow.blur / 2)} ${node.shadow.color})` : undefined,
  });

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{ aspectRatio: `${doc.width} / ${doc.height}`, background: doc.background, containerType: "inline-size" }}
    >
      {doc.nodes.map((node) => {
        switch (node.type) {
          case "image":
            return node.src ? (
              // eslint-disable-next-line @next/next/no-img-element -- decorative demo artwork
              <img
                key={node.id}
                src={node.src}
                alt=""
                style={{
                  ...box(node, node.width, node.height),
                  objectFit: "cover",
                  borderRadius: cq(node.cornerRadius),
                  outline: node.stroke ? `${cq(node.stroke.width)} solid ${node.stroke.color}` : undefined,
                }}
              />
            ) : (
              <div key={node.id} aria-hidden style={{ ...box(node, node.width, node.height), background: "rgba(128,128,128,0.18)", borderRadius: cq(node.cornerRadius) }} />
            );
          case "shape": {
            if (node.shape === "arc" && node.arc) {
              const r = 50;
              const inner = Math.max(0, r - (node.arc.thickness / node.width) * 100);
              const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
              const a0 = rad(node.arc.start);
              const a1 = rad(node.arc.start + Math.min(359.99, node.arc.sweep));
              const large = node.arc.sweep > 180 ? 1 : 0;
              const pt = (radius: number, angle: number) => `${50 + radius * Math.cos(angle)} ${50 + radius * Math.sin(angle)}`;
              const d = `M${pt(r, a0)}A${r} ${r} 0 ${large} 1 ${pt(r, a1)}L${pt(inner, a1)}A${inner} ${inner} 0 ${large} 0 ${pt(inner, a0)}Z`;
              return (
                <svg key={node.id} aria-hidden viewBox="0 0 100 100" style={box(node, node.width, node.height)}>
                  <path d={d} fill={node.fill} />
                </svg>
              );
            }
            return (
              <div
                key={node.id}
                aria-hidden
                style={{
                  ...box(node, node.width, node.height),
                  background: node.gradient ? `linear-gradient(${node.gradient.from}, ${node.gradient.to})` : node.fill,
                  borderRadius: node.shape === "ellipse" ? "50%" : cq(node.cornerRadius),
                  border: node.stroke ? `${cq(node.stroke.width)} solid ${node.stroke.color}` : undefined,
                  boxSizing: "border-box",
                }}
              />
            );
          }
          case "path":
            return (
              <svg key={node.id} aria-hidden viewBox={`0 0 ${node.viewBox[0]} ${node.viewBox[1]}`} preserveAspectRatio="none" style={box(node, node.width, node.height)}>
                {node.paths.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill={node.fill ?? "none"}
                    stroke={node.stroke?.color ?? "none"}
                    strokeWidth={node.stroke?.width ?? 0}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </svg>
            );
          case "text":
            return (
              <p
                key={node.id}
                style={{
                  ...box(node, node.width),
                  margin: 0,
                  fontFamily: FONT_FAMILIES[node.font],
                  fontSize: cq(node.fontSize),
                  fontWeight: node.fontWeight,
                  fontStyle: node.italic ? "italic" : "normal",
                  lineHeight: node.lineHeight,
                  letterSpacing: cq(node.letterSpacing),
                  textTransform: node.uppercase ? "uppercase" : "none",
                  textAlign: node.align,
                  color: node.fill,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "break-word",
                }}
              >
                {node.text}
              </p>
            );
        }
      })}
    </div>
  );
}
