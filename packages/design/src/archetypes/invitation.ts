import type { Blocks } from "./shared";
import { contactLines, fitHeadline, inkOn, mutedOn, placeHeadline, rect, stack, text, textHeight, accentOn, type Ctx } from "../engine";

/**
 * Invitation: formal and centred inside a double-rule frame with diamond corners — a
 * script line, the headline, an ornamental divider, then each detail on its own line,
 * the way stationery is set. Weddings, galas, showers, ceremonies, dinners.
 */
export function invitation(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const field = P.surface;
  ctx.background = field;
  const ink = inkOn(ctx, field);
  const muted = mutedOn(ctx, field);
  const line = accentOn(ctx, field, true);
  const small = accentOn(ctx, field, false);
  const wide = orientation === "landscape";

  // ── Frame: two rules and a diamond on each inner corner ────────────────
  const outer = Math.round(m * 0.45);
  const inner = outer + Math.round(u * 1.4);
  const hair = Math.max(1, Math.round(u * 0.18));
  rect(ctx, { x: outer, y: outer, width: W - 2 * outer, height: H - 2 * outer }, "transparent", { stroke: { color: line, width: hair * 2 }, name: "Frame", locked: true });
  rect(ctx, { x: inner, y: inner, width: W - 2 * inner, height: H - 2 * inner }, "transparent", { stroke: { color: line, width: hair }, name: "Frame", locked: true });
  const d = u * 1.6;
  const diamond = (cx: number, cy: number, size: number, name = "Ornament") => rect(ctx, { x: cx, y: cy - size / Math.SQRT2, width: size, height: size }, line, { rotation: 45, name });
  for (const [cx, cy] of [
    [inner, inner],
    [W - inner, inner],
    [inner, H - inner],
    [W - inner, H - inner],
  ] as const) diamond(cx, cy, d);

  // ── Centred column ──────────────────────────────────────────────────────
  const width = wide ? W * 0.62 : W - 2 * (inner + m * 0.75);
  const x = (W - width) / 2;
  const footer = contactLines(C)
    .slice(0, 2)
    .map((l) => l.text)
    .join("   ·   ");
  const footerHeight = footer ? scale.caption * 1.4 : 0;
  if (footer) text(ctx, footer, { x, y: H - inner - m * 0.6 - footerHeight, width, size: scale.caption, role: T.label, color: muted, maxLines: 1, align: "center", name: "Contact" });

  const scriptSize = Math.round(scale.h1 * (wide ? 0.62 : 0.72));
  const headline = fitHeadline(ctx, C.headline, C.emphasis, width, scale.hero * (wide ? 0.8 : orientation === "square" ? 0.78 : 0.95), scale.h2, 3);
  const rows = C.details.slice(0, 4);
  const blocks: Blocks = [
    C.brand && {
      priority: 45,
      gapBefore: 0,
      height: () => scale.caption * T.label.leading,
      render: (bx: number, by: number, bw: number) => void text(ctx, C.brand!, { x: bx, y: by, width: bw, size: scale.caption, role: T.label, color: muted, maxLines: 1, align: "center", name: "Brand" }),
    },
    C.eyebrow && {
      priority: 70,
      gapBefore: u * 3,
      height: (bw: number) => textHeight(C.eyebrow!, T.script, scriptSize, bw, 1),
      render: (bx: number, by: number, bw: number) => void text(ctx, C.eyebrow!, { x: bx, y: by, width: bw, size: scriptSize, role: T.script, color: small, maxLines: 1, align: "center", name: "Script" }),
    },
    {
      priority: 100,
      gapBefore: u * 2,
      height: () => headline.lines.length * headline.size * T.display.leading,
      render: (bx: number, by: number, bw: number) => placeHeadline(ctx, headline, { x: bx, y: by, width: bw, align: "center", color: ink, emphasisColor: P.primary, background: field }),
    },
    {
      priority: 40,
      gapBefore: u * 4,
      height: () => u * 1.6,
      render: (bx: number, by: number, bw: number) => {
        const mid = bx + bw / 2;
        const arm = Math.min(bw * 0.2, W * 0.12);
        rect(ctx, { x: mid - arm - u * 2, y: by + u * 0.7, width: arm, height: hair }, line, { name: "Divider" });
        rect(ctx, { x: mid + u * 2, y: by + u * 0.7, width: arm, height: hair }, line, { name: "Divider" });
        diamond(mid - u * 0.55, by + u * 0.8, u * 1.1, "Divider");
      },
    },
    C.subhead && {
      priority: 75,
      gapBefore: u * 4,
      height: (bw: number) => textHeight(C.subhead!, T.heading, scale.lead, bw, 2),
      render: (bx: number, by: number, bw: number) => void text(ctx, C.subhead!, { x: bx, y: by, width: bw, size: scale.lead, role: T.heading, color: ink, maxLines: 2, align: "center", name: "Subhead" }),
    },
    rows.length > 0 && {
      priority: 85,
      gapBefore: u * 4,
      height: (bw: number) => rows.reduce((sum, row) => sum + textHeight(row.text, T.heading, scale.lead, bw, 2) + u * 1.4, -u * 1.4),
      render: (bx: number, by: number, bw: number) => {
        let cursor = by;
        for (const row of rows) cursor += text(ctx, row.text, { x: bx, y: cursor, width: bw, size: scale.lead, role: T.heading, color: ink, maxLines: 2, align: "center", name: "Detail" }).height + u * 1.4;
      },
    },
    C.body && {
      priority: 35,
      gapBefore: u * 3,
      height: (bw: number) => textHeight(C.body!, T.body, scale.body, bw * 0.86, 3),
      render: (bx: number, by: number, bw: number) => void text(ctx, C.body!, { x: bx + bw * 0.07, y: by, width: bw * 0.86, size: scale.body, role: T.body, color: muted, maxLines: 3, align: "center", name: "Body" }),
    },
    C.cta && {
      priority: 60,
      gapBefore: u * 4,
      height: (bw: number) => textHeight(C.cta!, T.label, scale.lead, bw, 1),
      render: (bx: number, by: number, bw: number) => void text(ctx, C.cta!, { x: bx, y: by, width: bw, size: scale.lead, role: T.label, color: small, maxLines: 1, align: "center", name: "RSVP" }),
    },
  ];

  const top = inner + m * 0.7;
  stack({ x, y: top, width, height: H - inner - m * 0.6 - footerHeight - u * 3 - top }, blocks, "justify");
}
