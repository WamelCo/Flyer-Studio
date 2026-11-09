import { ctaHeight, ctaPill, polygon } from "./shared";
import { contrast, CONTRAST } from "../color";
import { accentOn, contactLines, fitHeadline, inkOn, mutedOn, placeHeadline, softOn, stack, text, textHeight, type Ctx } from "../engine";

/**
 * Diagonal split: the page cut by one confident diagonal — headline on the open side,
 * the details on a colour field, an accent stripe riding the cut. Energy without photos.
 */
export function diagonalSplit(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  ctx.background = P.bg;
  const wide = orientation === "landscape";
  const field = contrast(P.onPrimary, P.primary) >= CONTRAST.body ? P.primary : P.dark;
  const fieldInk = field === P.primary ? P.onPrimary : inkOn(ctx, field);
  const fieldSoft = softOn(fieldInk, field, 0.84);
  const stripe = field === P.accent ? P.accent2 : P.accent;
  const ink = inkOn(ctx, P.bg);
  const muted = mutedOn(ctx, P.bg);
  const gap = u * 6;
  const band = u * 1.6;

  // The cut: rising left→right (portrait, square, story) or leaning right→left (landscape).
  let open: { x: number; y: number; width: number; height: number };
  let closed: { x: number; y: number; width: number; height: number };
  if (wide) {
    const top = W * 0.62;
    const bottom = W * 0.46;
    polygon(ctx, [[top - band * 2, 0], [top, 0], [bottom, H], [bottom - band * 2, H]], stripe, "Stripe");
    polygon(ctx, [[top, 0], [W, 0], [W, H], [bottom, H]], field);
    open = { x: m, y: m, width: bottom - band * 2 - gap - m, height: H - 2 * m };
    closed = { x: top + gap, y: m, width: W - m - top - gap, height: H - 2 * m };
  } else {
    const left = H * (orientation === "tall" ? 0.64 : 0.68);
    const right = H * (orientation === "tall" ? 0.46 : orientation === "square" ? 0.48 : 0.44);
    polygon(ctx, [[0, left - band * 2], [W, right - band * 2], [W, right], [0, left]], stripe, "Stripe");
    polygon(ctx, [[0, left], [W, right], [W, H], [0, H]], field);
    // The open side ends where the stripe meets the right margin; the field starts below the cut at x0.
    const x0 = W * 0.3;
    const cutAt = (x: number) => left + (right - left) * (x / W);
    open = { x: m, y: m, width: W - 2 * m, height: cutAt(W - m) - band * 2 - gap - m };
    const closedTop = cutAt(x0) + gap;
    closed = { x: x0, y: closedTop, width: W - m - x0, height: H - m - closedTop };
  }

  // ── Open side: brand, eyebrow, headline, subhead ───────────────────────
  const headline = fitHeadline(ctx, C.headline, C.emphasis, open.width, scale.hero * (wide ? 0.95 : 1.15), scale.h2, wide ? 4 : 3, 1, open.height * 0.8);
  stack(
    open,
    [
      C.brand && {
        priority: 50,
        gapBefore: 0,
        height: () => scale.body * T.label.leading,
        render: (x, y, w) => void text(ctx, C.brand!, { x, y, width: w, size: scale.body, role: T.label, color: ink, maxLines: 1, name: "Brand" }),
      },
      C.eyebrow && {
        priority: 60,
        gapBefore: u * 3,
        height: () => scale.lead * T.label.leading,
        render: (x, y, w) => void text(ctx, C.eyebrow!, { x, y, width: w, size: scale.lead, role: T.label, color: accentOn(ctx, P.bg, false), maxLines: 1, name: "Eyebrow" }),
      },
      {
        priority: 100,
        gapBefore: u * 2,
        height: () => headline.lines.length * headline.size * T.display.leading,
        render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: "left", color: ink, emphasisColor: P.primary, background: P.bg }),
      },
      C.subhead && {
        priority: 70,
        gapBefore: u * 3,
        height: (w: number) => textHeight(C.subhead!, T.heading, scale.lead, w * 0.85, 2),
        render: (x, y, w) => void text(ctx, C.subhead!, { x, y, width: w * 0.85, size: scale.lead, role: T.heading, color: muted, maxLines: 2, name: "Subhead" }),
      },
    ],
    wide ? "center" : "top",
  );

  // ── Field: details, body, CTA, contact (right-aligned against the cut) ──
  const align = wide ? "left" : "right";
  const anchor = (x: number, w: number) => (align === "right" ? x + w : x);
  const rows = C.details.slice(0, 4);
  // The key facts are set as display type: the field is the second voice of the poster, not a footnote.
  const detailSize = Math.round(wide ? scale.h2 * 0.85 : orientation === "square" ? scale.h2 * 0.9 : scale.h1 * 0.68);
  const contact = contactLines(C).slice(0, 2);
  stack(
    closed,
    [
      rows.length > 0 && {
        priority: 80,
        gapBefore: 0,
        height: (w: number) => rows.reduce((sum, row) => sum + textHeight(row.text, T.display, detailSize, w, 2) + u * 1.2, -u * 1.2),
        render: (x: number, y: number, w: number) => {
          let cursor = y;
          for (const row of rows) {
            const placed = text(ctx, row.text, { x, y: cursor, width: w, size: detailSize, role: T.display, color: fieldInk, maxLines: 2, align, name: "Detail" });
            cursor += placed.height + u * 1.2;
          }
        },
      },
      C.body && {
        priority: 40,
        gapBefore: u * 4,
        height: (w: number) => textHeight(C.body!, T.body, scale.body, w * 0.9, 3),
        render: (x: number, y: number, w: number) => void text(ctx, C.body!, { x: align === "right" ? x + w * 0.1 : x, y, width: w * 0.9, size: scale.body, role: T.body, color: fieldSoft, maxLines: 3, align, name: "Body" }),
      },
      C.cta && {
        priority: 60,
        gapBefore: u * 5,
        height: () => ctaHeight(ctx),
        render: (x: number, y: number, w: number) => void ctaPill(ctx, C.cta!, { x: anchor(x, w), y, color: fieldInk, align, maxWidth: w }),
      },
      contact.length > 0 && {
        priority: 50,
        gapBefore: u * 4,
        height: () => contact.length * scale.body * T.body.leading * 1.15,
        render: (x: number, y: number, w: number) => {
          contact.forEach((line, i) => text(ctx, line.text, { x, y: y + i * scale.body * T.body.leading * 1.15, width: w, size: scale.body, role: T.body, color: fieldInk, maxLines: 1, align, name: "Contact" }));
        },
      },
    ],
    wide ? "center" : "bottom",
  );
}
