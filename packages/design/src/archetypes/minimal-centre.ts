import { ctaHeight, ctaPill, joinDetails, type Blocks } from "./shared";
import { alpha } from "../color";
import { accentOn, contactLines, fitHeadline, inkOn, mutedOn, placeHeadline, rect, stack, text, textHeight, type Ctx } from "../engine";

/**
 * Minimal centre: one quiet centred column on an open field inside a hairline mat —
 * the restraint of a gallery card. Hierarchy comes from size and space alone.
 */
export function minimalCentre(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  ctx.background = P.bg;
  const ink = inkOn(ctx, P.bg);
  const muted = mutedOn(ctx, P.bg);
  const accent = accentOn(ctx, P.bg, false);
  const wide = orientation === "landscape";
  const width = wide ? W * 0.58 : W - 2 * m * (orientation === "tall" ? 1.15 : 1.55);
  const x = (W - width) / 2;

  // The mat: a hairline frame set in from the edge.
  const inset = Math.round(m * 0.42);
  rect(ctx, { x: inset, y: inset, width: W - 2 * inset, height: H - 2 * inset }, "transparent", {
    stroke: { color: alpha(ink, 0.22), width: Math.max(1, Math.round(u * 0.15)) },
    name: "Frame",
    locked: true,
  });

  const brandHeight = C.brand ? scale.caption * 1.4 : 0;
  if (C.brand) text(ctx, C.brand, { x, y: m, width, size: scale.caption, role: T.label, color: ink, maxLines: 1, align: "center", name: "Brand" });

  const footer = contactLines(C)
    .slice(0, 2)
    .map((line) => line.text)
    .join("   ·   ");
  const footerHeight = footer ? scale.caption * 1.4 : 0;
  if (footer) text(ctx, footer, { x: m, y: H - m - footerHeight, width: W - 2 * m, size: scale.caption, role: T.label, color: muted, maxLines: 1, align: "center", name: "Contact" });

  // A short headline earns more size; the column, not the type, sets the restraint.
  const short = C.headline.length <= 24 ? 1.3 : 1;
  const headline = fitHeadline(ctx, C.headline, C.emphasis, width, scale.hero * short * (wide ? 0.9 : orientation === "square" ? 0.85 : 1.05), scale.h2, wide ? 2 : 3);
  const narrow = width * 0.82;
  const blocks: Blocks = [
    C.eyebrow && {
      priority: 60,
      gapBefore: 0,
      height: () => scale.body * T.label.leading,
      render: (bx, by, bw) => void text(ctx, C.eyebrow!, { x: bx, y: by, width: bw, size: scale.body, role: T.label, color: accent, maxLines: 1, align: "center", name: "Eyebrow" }),
    },
    {
      priority: 100,
      gapBefore: u * 3,
      height: () => headline.lines.length * headline.size * T.display.leading,
      render: (bx, by, bw) => placeHeadline(ctx, headline, { x: bx, y: by, width: bw, align: "center", color: ink, emphasisColor: P.primary, background: P.bg }),
    },
    {
      priority: 40,
      gapBefore: u * 5,
      height: () => Math.max(2, u * 0.3),
      render: (bx, by, bw) => void rect(ctx, { x: bx + bw / 2 - W * 0.035, y: by, width: W * 0.07, height: Math.max(2, u * 0.3) }, accent, { name: "Divider" }),
    },
    C.subhead && {
      priority: 70,
      gapBefore: u * 5,
      height: () => textHeight(C.subhead!, T.heading, scale.lead, narrow, 2),
      render: (bx, by, bw) => void text(ctx, C.subhead!, { x: bx + (bw - narrow) / 2, y: by, width: narrow, size: scale.lead, role: T.heading, color: ink, maxLines: 2, align: "center", name: "Subhead" }),
    },
    C.body && {
      priority: 35,
      gapBefore: u * 2.5,
      height: () => textHeight(C.body!, T.body, scale.body, narrow * 0.9, 3),
      render: (bx, by, bw) => void text(ctx, C.body!, { x: bx + (bw - narrow * 0.9) / 2, y: by, width: narrow * 0.9, size: scale.body, role: T.body, color: muted, maxLines: 3, align: "center", name: "Body" }),
    },
    C.details.length > 0 && {
      priority: 55,
      gapBefore: u * 5,
      height: (bw: number) => textHeight(joinDetails(ctx), T.label, scale.body, bw, 2),
      render: (bx, by, bw) => void text(ctx, joinDetails(ctx), { x: bx, y: by, width: bw, size: scale.body, role: T.label, color: ink, maxLines: 2, align: "center", name: "Details" }),
    },
    C.cta && {
      priority: 30,
      gapBefore: u * 5,
      height: () => ctaHeight(ctx),
      render: (bx, by, bw) => void ctaPill(ctx, C.cta!, { x: bx + bw / 2, y: by, color: ink, align: "center", outline: true, maxWidth: bw }),
    },
  ];

  const top = m + brandHeight + u * 6;
  stack({ x, y: top, width, height: H - m - footerHeight - u * 6 - top }, blocks, "center");
}
