import { ctaHeight, ctaPill, headlineFigure } from "./shared";
import {
  accentOn,
  contactLines,
  fitHeadline,
  iconRows,
  iconRowsHeight,
  inkOn,
  mutedOn,
  placeHeadline,
  rect,
  stack,
  styleOf,
  text,
  textHeight,
  type Ctx,
} from "../engine";
import { measure } from "../metrics";

/**
 * Big number: one figure from the copy — the offer, an age, a year, a date — set at
 * poster scale as the graphic itself, with the message set tight beneath it. Without
 * a figure the headline's initial becomes a monogram. The figure is never invented.
 */
export function bigNumber(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const field = P.dark;
  ctx.background = field;
  const ink = inkOn(ctx, field);
  const muted = mutedOn(ctx, field);
  const figureColor = accentOn(ctx, field, true);
  const small = accentOn(ctx, field, false);
  const wide = orientation === "landscape";

  const figure = headlineFigure(C) ?? C.headline.trim().charAt(0).toUpperCase();
  // The figure's box: the left half in landscape, the top ~45% otherwise.
  const area = wide
    ? { x: m, y: m, width: W * 0.46 - m, height: H - 2 * m }
    : { x: m, y: m + (C.brand ? scale.body * 2.4 : 0), width: W - 2 * m, height: H * (orientation === "tall" ? 0.36 : orientation === "square" ? 0.4 : 0.42) };
  const role = { ...T.display, leading: 0.86 };
  const unit = measure(figure, styleOf(role, 100)) / 100;
  // As big as the box allows: width-bound for long figures, height-bound for a single digit.
  const size = Math.floor(Math.min(area.width / Math.max(unit, 0.3), area.height / 0.95, scale.hero * 5));
  const figureHeight = size * role.leading;
  // A wide figure is width-bound and shorter than its box: the box shrinks to it, so the copy follows on.
  if (!wide) area.height = Math.min(area.height, figureHeight);
  const figureY = wide ? area.y + (area.height - figureHeight) / 2 : area.y;
  text(ctx, figure, { x: area.x, y: figureY, width: area.width, size, role, color: figureColor, maxLines: 1, name: "Figure" });

  if (C.brand) text(ctx, C.brand, { x: m, y: m, width: W * 0.6, size: scale.body, role: T.label, color: ink, maxLines: 1, name: "Brand" });

  // ── The message ─────────────────────────────────────────────────────────
  const column = wide
    ? { x: W * 0.52, y: m, width: W * 0.48 - m, height: H - 2 * m }
    : { x: m, y: area.y + area.height + u * 5, width: W - 2 * m, height: H - m - (area.y + area.height + u * 5) };
  if (!wide) rect(ctx, { x: m, y: area.y + area.height + u * 2, width: W - 2 * m, height: Math.max(2, u * 0.45) }, figureColor, { name: "Rule" });
  else rect(ctx, { x: W * 0.49, y: m, width: Math.max(2, u * 0.45), height: H - 2 * m }, figureColor, { name: "Rule" });

  const footer = contactLines(C).slice(0, 2);
  const footerHeight = footer.length ? footer.length * scale.body * T.body.leading * 1.1 + u * 3 : 0;
  const body = { ...column, height: column.height - footerHeight };
  const headline = fitHeadline(ctx, C.headline, C.emphasis, body.width, scale.h1 * (wide ? 1.1 : 1.25), scale.h3, 3, 1, body.height * 0.5);
  const rows = C.details.slice(0, 3);
  stack(
    body,
    [
      C.eyebrow && {
        priority: 55,
        gapBefore: 0,
        height: () => scale.body * T.label.leading,
        render: (x: number, y: number, w: number) => void text(ctx, C.eyebrow!, { x, y, width: w, size: scale.body, role: T.label, color: small, maxLines: 1, name: "Eyebrow" }),
      },
      {
        priority: 100,
        gapBefore: u * 2,
        height: () => headline.lines.length * headline.size * T.display.leading,
        render: (x: number, y: number, w: number) => placeHeadline(ctx, headline, { x, y, width: w, align: "left", color: ink, emphasisColor: P.primary, background: field }),
      },
      C.subhead && {
        priority: 70,
        gapBefore: u * 2.5,
        height: (w: number) => textHeight(C.subhead!, T.heading, scale.lead, w, 2),
        render: (x: number, y: number, w: number) => void text(ctx, C.subhead!, { x, y, width: w, size: scale.lead, role: T.heading, color: ink, maxLines: 2, name: "Subhead" }),
      },
      rows.length > 0 && {
        priority: 65,
        gapBefore: u * 4,
        height: (w: number) => iconRowsHeight(ctx, rows, w, scale.body),
        render: (x: number, y: number, w: number) => void iconRows(ctx, rows, x, y, w, scale.body, ink, small),
      },
      C.body && {
        priority: 35,
        gapBefore: u * 3,
        height: (w: number) => textHeight(C.body!, T.body, scale.body, w, 3),
        render: (x: number, y: number, w: number) => void text(ctx, C.body!, { x, y, width: w, size: scale.body, role: T.body, color: muted, maxLines: 3, name: "Body" }),
      },
      C.cta && {
        priority: 50,
        gapBefore: u * 4,
        height: () => ctaHeight(ctx),
        render: (x: number, y: number, w: number) => void ctaPill(ctx, C.cta!, { x, y, color: figureColor, maxWidth: w }),
      },
    ],
    wide ? "center" : "justify",
  );

  footer.forEach((line, i) => {
    const y = H - m - (footer.length - i) * scale.body * T.body.leading * 1.1;
    text(ctx, line.text, { x: column.x, y, width: column.width, size: scale.body, role: T.body, color: muted, maxLines: 1, name: "Contact" });
  });
}
