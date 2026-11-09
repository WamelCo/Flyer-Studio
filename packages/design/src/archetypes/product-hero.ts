import { ctaHeight, ctaPill, headlineFigure, joinDetails, type Blocks } from "./shared";
import {
  accentOn,
  circle,
  contactLines,
  fitHeadline,
  hasPhoto,
  icon,
  iconChip,
  inkOn,
  mutedOn,
  photo,
  placeHeadline,
  rect,
  stack,
  starburst,
  text,
  textHeight,
  type Ctx,
} from "../engine";

/**
 * Product hero: the product (or dish, or object) as a big rounded photograph on a soft
 * tinted field with a colour disc behind it, the headline above, a price badge when the
 * copy states one, feature chips and the call to action below. Launches and shop promos.
 */
export function productHero(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const field = P.tint;
  ctx.background = field;
  const ink = inkOn(ctx, field);
  const muted = mutedOn(ctx, field);
  const accent = accentOn(ctx, field, false);
  const wide = orientation === "landscape";
  const tall = orientation === "tall";

  // ── Geometry: copy column and photo frame ──────────────────────────────────
  let features = C.features.slice(0, 3);
  const copyBox = wide ? { x: m, y: m, width: W * 0.44 - m, height: H - 2 * m } : { x: m, y: m, width: W - 2 * m, height: 0 };
  const headline = fitHeadline(ctx, C.headline, C.emphasis, copyBox.width, scale.hero * (wide ? 0.85 : 0.95), scale.h2, wide ? 3 : 2);
  const headlineHeight = headline.lines.length * headline.size * T.display.leading;
  const eyebrowHeight = C.eyebrow ? scale.body * T.label.leading + u * 2 : 0;
  const frameTop = m + eyebrowHeight + headlineHeight + (C.subhead ? u * 2 + scale.lead * 1.3 : 0) + u * 6;
  const chipRow = scale.body * 4.6;
  const room = (withChips: boolean) => H - m - (C.cta ? ctaHeight(ctx) : 0) - (withChips && features.length ? chipRow + u * 4 : 0) - u * 6 - frameTop;
  // The product needs room: the chips go before the photo is squeezed, and nothing overlaps.
  const minimum = H * (tall ? 0.3 : 0.24);
  if (!wide && room(true) < minimum) features = [];
  const chipsHeight = features.length ? chipRow : 0;
  const frame = wide ? { x: W * 0.5, y: m, width: W * 0.5 - m, height: H - 2 * m } : { x: m, y: frameTop, width: W - 2 * m, height: room(true) };

  // The disc behind the product.
  // It may bleed sideways but never above or below the frame, where the copy sits.
  const discR = Math.min(frame.width * 0.62, frame.height * 0.5);
  circle(ctx, frame.x + frame.width * 0.62, frame.y + frame.height / 2, discR, P.primary, { name: "Disc" });
  if (hasPhoto(ctx, 0)) {
    photo(ctx, 0, frame, { cornerRadius: u * 3, shadow: true, name: "Product photo" });
  } else {
    rect(ctx, frame, P.surface, { cornerRadius: u * 3, shadow: { color: "rgba(0,0,0,0.18)", blur: u * 3, offsetX: 0, offsetY: u }, name: "Product card" });
    const size = Math.min(frame.width, frame.height) * 0.3;
    icon(ctx, features[0]?.icon ?? "shopping-bag", frame.x + (frame.width - size) / 2, frame.y + (frame.height - size) / 2, size, accentOn(ctx, P.surface, true), 1.6);
  }

  // A price or offer badge on the frame's corner — only when the copy states one.
  const figure = headlineFigure(C);
  if (figure && /[%$€£₦¥]/.test(figure)) {
    const r = Math.min(frame.width, frame.height) * 0.14;
    const cx = frame.x + frame.width - r * 0.7;
    const cy = frame.y + r * 0.7;
    const fill = P.dark;
    starburst(ctx, cx, cy, r, fill);
    const size = Math.round(r * (figure.length > 4 ? 0.42 : 0.55));
    text(ctx, figure, { x: cx - r * 0.75, y: cy - size * 0.55, width: r * 1.5, size, role: T.display, color: inkOn(ctx, fill, true), maxLines: 1, align: "center", name: "Badge" });
  }

  // ── Copy ─────────────────────────────────────────────────────────────────
  const blocks: Blocks = [
    C.eyebrow && {
      priority: 60,
      gapBefore: 0,
      height: () => scale.body * T.label.leading,
      render: (x, y, w) => void text(ctx, C.eyebrow!, { x, y, width: w, size: scale.body, role: T.label, color: accent, maxLines: 1, align: wide ? "left" : "center", name: "Eyebrow" }),
    },
    {
      priority: 100,
      gapBefore: u * 2,
      height: () => headlineHeight,
      render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: wide ? "left" : "center", color: ink, emphasisColor: P.primary, background: field }),
    },
    C.subhead && {
      priority: 70,
      gapBefore: u * 2,
      height: (w) => textHeight(C.subhead!, T.heading, scale.lead, w, wide ? 2 : 1),
      render: (x, y, w) => void text(ctx, C.subhead!, { x, y, width: w, size: scale.lead, role: T.heading, color: muted, maxLines: wide ? 2 : 1, align: wide ? "left" : "center", name: "Subhead" }),
    },
    wide &&
      C.details.length > 0 && {
        priority: 50,
        gapBefore: u * 4,
        height: (w) => textHeight(joinDetails(ctx), T.label, scale.body, w, 2),
        render: (x, y, w) => void text(ctx, joinDetails(ctx), { x, y, width: w, size: scale.body, role: T.label, color: ink, maxLines: 2, name: "Details" }),
      },
  ];
  if (wide) {
    // Chips and CTA join the copy column.
    if (features.length) {
      blocks.push({ priority: 55, gapBefore: u * 5, height: () => chipsHeight, render: (x, y, w) => chips(x, y, w) });
    }
    if (C.cta) blocks.push({ priority: 45, gapBefore: u * 5, height: () => ctaHeight(ctx), render: (x, y, w) => void ctaPill(ctx, C.cta!, { x, y, color: P.primary, maxWidth: w }) });
    stack(copyBox, blocks, "center");
  } else {
    stack({ x: m, y: m, width: W - 2 * m, height: frame.y - u * 6 - m }, blocks, "bottom");
    let y = frame.y + frame.height + u * 6;
    if (features.length) {
      chips(m, y, W - 2 * m);
      y += chipsHeight + u * 4;
    }
    if (C.cta) ctaPill(ctx, C.cta, { x: W / 2, y, color: P.primary, align: "center", maxWidth: W - 2 * m });
  }

  const contact = contactLines(C)[0]?.text ?? null;
  if (contact && !wide) text(ctx, contact, { x: m, y: H - m * 0.55 - scale.caption, width: W - 2 * m, size: scale.caption, role: T.label, color: muted, maxLines: 1, align: "center", name: "Contact" });

  /** Up to three icon chips with a short title under each. */
  function chips(x: number, y: number, width: number) {
    const cell = width / features.length;
    const size = Math.round(scale.body * 2.2);
    features.forEach((f, i) => {
      const cx = x + cell * i + cell / 2;
      iconChip(ctx, f.icon, cx - size / 2, y, size, P.dark, inkOn(ctx, P.dark), true);
      text(ctx, f.title, { x: cx - cell * 0.45, y: y + size + u * 1.2, width: cell * 0.9, size: scale.body, role: T.heading, color: ink, maxLines: 1, align: "center", name: "Feature" });
    });
  }
}
