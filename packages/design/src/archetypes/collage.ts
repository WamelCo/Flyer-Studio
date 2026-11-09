import { ctaHeight, ctaPill, type Blocks } from "./shared";
import {
  accentOn,
  contactLines,
  fitHeadline,
  hasPhoto,
  icon,
  iconRows,
  iconRowsHeight,
  inkOn,
  mutedOn,
  photo,
  placeHeadline,
  rect,
  stack,
  text,
  textHeight,
  type Ctx,
} from "../engine";

/**
 * Collage: an asymmetric mosaic of up to four photographs — one large, the rest stacked
 * beside it — over a clean copy panel. Missing photos become colour tiles, never empty
 * frames. Travel, community, recaps, schools, real estate.
 */
export function collage(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  ctx.background = P.bg;
  const ink = inkOn(ctx, P.bg);
  const muted = mutedOn(ctx, P.bg);
  const accent = accentOn(ctx, P.bg, false);
  const wide = orientation === "landscape";
  const g = Math.round(u * 1.4);
  const r = Math.round(u * 1.6);

  // ── Mosaic ───────────────────────────────────────────────────────────────
  const grid = wide
    ? { x: m * 0.6, y: m * 0.6, width: W * 0.56, height: H - 1.2 * m }
    : { x: m * 0.6, y: m * 0.6, width: W - 1.2 * m, height: H * (orientation === "tall" ? 0.54 : orientation === "square" ? 0.5 : 0.55) };
  const big = { x: grid.x, y: grid.y, width: grid.width * 0.6 - g / 2, height: grid.height };
  const sideX = grid.x + grid.width * 0.6 + g / 2;
  const sideW = grid.width * 0.4 - g / 2;
  const four = hasPhoto(ctx, 3);
  const cells = [
    big,
    { x: sideX, y: grid.y, width: sideW, height: grid.height * 0.5 - g / 2 },
    four ? { x: sideX, y: grid.y + grid.height * 0.5 + g / 2, width: sideW / 2 - g / 2, height: grid.height * 0.5 - g / 2 } : { x: sideX, y: grid.y + grid.height * 0.5 + g / 2, width: sideW, height: grid.height * 0.5 - g / 2 },
    ...(four ? [{ x: sideX + sideW / 2 + g / 2, y: grid.y + grid.height * 0.5 + g / 2, width: sideW / 2 - g / 2, height: grid.height * 0.5 - g / 2 }] : []),
  ];
  const tiles = [P.primary, P.accent, P.dark];
  cells.forEach((cell, i) => {
    if (hasPhoto(ctx, i)) {
      photo(ctx, i, cell, { cornerRadius: r, name: i === 0 ? "Photo main" : "Photo" });
    } else {
      // A colour tile with a quiet icon, so a missing photo never reads as an empty frame.
      const fill = tiles[i % tiles.length]!;
      rect(ctx, cell, fill, { cornerRadius: r, name: "Colour tile" });
      const size = Math.min(cell.width, cell.height) * 0.28;
      icon(ctx, C.features[i]?.icon ?? C.details[i]?.icon ?? "sparkles", cell.x + (cell.width - size) / 2, cell.y + (cell.height - size) / 2, size, inkOn(ctx, fill, true), 1.6);
    }
  });

  // ── Copy panel ───────────────────────────────────────────────────────────
  const panel = wide
    ? { x: grid.x + grid.width + m * 0.9, y: m, width: W - m - (grid.x + grid.width + m * 0.9), height: H - 2 * m }
    : { x: m, y: grid.y + grid.height + u * 6, width: W - 2 * m, height: H - m - (grid.y + grid.height + u * 6) };
  const headline = fitHeadline(ctx, C.headline, C.emphasis, panel.width, scale.hero * (wide ? 0.75 : 0.95), scale.h2, 3, 1, panel.height * 0.45);
  const rows = C.details.slice(0, 3);
  const contact = contactLines(C)[0]?.text ?? C.contact.social[0] ?? null;
  const blocks: Blocks = [
    C.eyebrow && {
      priority: 55,
      gapBefore: 0,
      height: () => scale.body * T.label.leading,
      render: (x, y, w) => void text(ctx, C.eyebrow!, { x, y, width: w, size: scale.body, role: T.label, color: accent, maxLines: 1, name: "Eyebrow" }),
    },
    {
      priority: 100,
      gapBefore: u * 2,
      height: () => headline.lines.length * headline.size * T.display.leading,
      render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: "left", color: ink, emphasisColor: P.primary, background: P.bg }),
    },
    C.subhead && {
      priority: 70,
      gapBefore: u * 2,
      height: (w) => textHeight(C.subhead!, T.heading, scale.lead, w, 2),
      render: (x, y, w) => void text(ctx, C.subhead!, { x, y, width: w, size: scale.lead, role: T.heading, color: muted, maxLines: 2, name: "Subhead" }),
    },
    rows.length > 0 && {
      priority: 60,
      gapBefore: u * 4,
      height: (w) => iconRowsHeight(ctx, rows, w, scale.body),
      render: (x, y, w) => void iconRows(ctx, rows, x, y, w, scale.body, ink, accent),
    },
    C.body && {
      priority: 30,
      gapBefore: u * 3,
      height: (w) => textHeight(C.body!, T.body, scale.body, w, 3),
      render: (x, y, w) => void text(ctx, C.body!, { x, y, width: w, size: scale.body, role: T.body, color: muted, maxLines: 3, name: "Body" }),
    },
    C.cta && {
      priority: 50,
      gapBefore: u * 4,
      height: () => ctaHeight(ctx),
      render: (x, y, w) => void ctaPill(ctx, C.cta!, { x, y, color: P.primary, maxWidth: w }),
    },
    contact && {
      priority: 40,
      gapBefore: u * 3,
      height: () => scale.body * T.label.leading,
      render: (x, y, w) => void text(ctx, contact, { x, y, width: w, size: scale.body, role: T.label, color: muted, maxLines: 1, name: "Contact" }),
    },
  ];
  stack(panel, blocks, wide ? "center" : "justify");
}
