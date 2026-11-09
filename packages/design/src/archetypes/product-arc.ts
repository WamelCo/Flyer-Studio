import { ctaPill, type Blocks } from "./shared";
import { contrast, mix } from "../color";
import { accentOn, circle, contactLines, fitHeadline, hasPhoto, icon, inkOn, mutedOn, photo, placeHeadline, rect, stack, text, textHeight, type Ctx, type IconName } from "../engine";

/**
 * Product arc: the product in a circle at the heart of a wide gradient ring, its benefits
 * set on icon chips that follow the ring's curve, the headline above in a confident serif,
 * the call to action at the foot. Paper texture underneath. Cosmetics, food, wellness.
 */
export function productArc(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const field = P.bg;
  ctx.background = field;
  rect(ctx, { x: 0, y: 0, width: W, height: H }, "#808080", { texture: "grain", opacity: 0.1, blend: "multiply", name: "Paper texture", locked: true });
  const wide = orientation === "landscape";
  const paper = mix(field, "#808080", 0.12); // what the eye sees through the grain
  const ink = inkOn(ctx, paper);
  const muted = mutedOn(ctx, paper);
  const accent = accentOn(ctx, paper, false);

  // ── Header ───────────────────────────────────────────────────────────────
  const header = wide ? { x: W * 0.5, y: m, width: W * 0.5 - m, height: H * 0.34 } : { x: m, y: m * 0.9, width: W - 2 * m, height: H * (orientation === "tall" ? 0.2 : 0.22) };
  const headline = fitHeadline(ctx, C.headline, C.emphasis, header.width, scale.hero * (wide ? 0.85 : 1), scale.h2, 2, 1, header.height * 0.75);
  stack(
    header,
    [
      C.eyebrow && {
        priority: 60,
        gapBefore: 0,
        height: (w) => textHeight(C.eyebrow!, T.heading, scale.lead, w, 1),
        render: (x, y, w) => void text(ctx, C.eyebrow!, { x, y, width: w, size: scale.lead, role: T.heading, color: muted, maxLines: 1, align: wide ? "left" : "right", name: "Eyebrow" }),
      },
      {
        priority: 100,
        gapBefore: u * 1.2,
        height: () => headline.lines.length * headline.size * T.display.leading,
        render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: wide ? "left" : "right", color: ink, emphasisColor: P.primary, background: [field, paper] }),
      },
    ],
    wide ? "bottom" : "top",
  );

  // ── The ring and the product ─────────────────────────────────────────────
  const R = wide ? H * 0.42 : Math.min(W * 0.46, H * 0.3);
  const cx = wide ? W * 0.27 : W * 0.36;
  const cy = wide ? H * 0.52 : header.y + header.height + R + u * 4;
  const ringFrom = P.primary;
  const ringTo = contrast(P.accent, field) > 1.4 ? P.accent : mix(P.primary, "#000000", 0.25);
  const outer = circle(ctx, cx, cy, R, ringFrom, { name: "Ring" });
  outer.gradient = { from: ringFrom, to: ringTo };
  circle(ctx, cx, cy, R * 0.7, field, { name: "Ring hole" });
  const productR = R * 0.62;
  if (hasPhoto(ctx, 0)) {
    photo(ctx, 0, { x: cx - productR, y: cy - productR, width: productR * 2, height: productR * 2 }, { cornerRadius: productR, stroke: { color: "#FFFFFF", width: Math.round(u * 0.9) }, shadow: true, name: "Product photo" });
  } else {
    circle(ctx, cx, cy, productR, P.surface, { name: "Product slot" });
    const size = productR * 0.7;
    icon(ctx, (C.features[0]?.icon ?? "shopping-bag") as IconName, cx - size / 2, cy - size / 2, size, accentOn(ctx, P.surface, true), 1.4);
  }

  // ── Benefits on chips along the ring's right side ────────────────────────
  const benefits = (C.features.length ? C.features.map((f) => ({ icon: f.icon, text: f.title })) : C.details.map((d) => ({ icon: d.icon, text: d.text }))).slice(0, 4);
  const chip = Math.round(Math.min(R * 0.24, scale.body * 3.2));
  const band = R * 0.85;
  const span = Math.min(110, 34 * benefits.length);
  benefits.forEach((benefit, i) => {
    const start = wide ? 8 : -span / 2;
    const angle = ((start + (benefits.length > 1 ? (span * i) / (benefits.length - 1) : span / 2)) * Math.PI) / 180;
    const px = cx + band * Math.cos(angle);
    const py = cy + band * Math.sin(angle);
    circle(ctx, px, py, chip / 2, field, { stroke: { color: P.primary, width: Math.max(2, u * 0.25) }, name: "Chip" });
    const glyph = chip * 0.5;
    icon(ctx, benefit.icon as IconName, px - glyph / 2, py - glyph / 2, glyph, accent, 2);
    // The label starts clear of the ring's outer edge, so it always sits on the paper.
    const edge = cx + Math.sqrt(Math.max(0, R * R - (py - cy) ** 2));
    const lx = Math.max(px + chip / 2 + u * 1.5, edge + u * 2);
    const width = Math.min(W - m * 0.6 - lx, wide ? W * 0.4 : W * 0.5);
    if (width > scale.body * 4) text(ctx, benefit.text, { x: lx, y: py - scale.lead * 0.7, width, size: scale.lead, role: T.heading, color: ink, maxLines: 2, name: "Benefit" });
  });

  // ── Foot ─────────────────────────────────────────────────────────────────
  const footTop = wide ? cy + R * 0.55 : cy + R + u * 5;
  const foot: Blocks = [
    C.subhead && {
      priority: 50,
      gapBefore: 0,
      height: (w) => textHeight(C.subhead!, T.body, scale.body, w, 2),
      render: (x, y, w) => void text(ctx, C.subhead!, { x, y, width: w, size: scale.body, role: T.body, color: muted, maxLines: 2, align: "right", name: "Subhead" }),
    },
    C.cta && {
      priority: 70,
      gapBefore: u * 3,
      height: () => scale.body * 2.5,
      render: (x, y, w) => void ctaPill(ctx, C.cta!, { x: x + w, y, color: P.dark, align: "right", maxWidth: w }),
    },
    contactLines(C).length > 0 && {
      priority: 40,
      gapBefore: u * 2.5,
      height: () => scale.body * T.label.leading,
      render: (x, y, w) => void text(ctx, contactLines(C)[0]!.text, { x, y, width: w, size: scale.body, role: T.label, color: ink, maxLines: 1, align: "right", name: "Contact" }),
    },
  ];
  const footX = wide ? W * 0.5 : W * 0.4;
  stack({ x: footX, y: footTop, width: W - m - footX, height: H - m - footTop }, foot, wide ? "bottom" : "center");
  if (C.brand) text(ctx, C.brand, { x: m, y: H - m - scale.body * 1.3, width: W * 0.35, size: scale.body, role: T.label, color: ink, maxLines: 1, name: "Brand" });
}
