import { isShort, rotateGroup, socialLine } from "./shared";
import {
  accentOn,
  bracket,
  fitHeadline,
  hasPhoto,
  icon,
  iconChip,
  iconRows,
  inkOn,
  mutedOn,
  photo,
  placeHeadline,
  rect,
  styleOf,
  text,
  type Ctx,
} from "../engine";
import { measure } from "../metrics";

/**
 * Bold stack (healthcare reference): a tilted stack of heavy condensed type with one
 * oversized coloured word, a fan of white-bordered photo frames, accent bars and
 * brackets, and a hard-edged CTA block with the phone number.
 */
export function boldStack(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  ctx.background = P.bg;
  const ink = inkOn(ctx, P.bg);
  const muted = mutedOn(ctx, P.bg);
  const accent = accentOn(ctx, P.bg);
  const wide = orientation === "landscape";
  const tall = orientation === "tall";

  // ── Brand lockup ───────────────────────────────────────────────────────
  if (C.brand) {
    const size = scale.lead;
    iconChip(ctx, C.features[0]?.icon ?? "star", m, m, Math.round(size * 1.5), P.primary, P.onPrimary);
    text(ctx, C.brand, { x: m + size * 2, y: m + size * 0.18, width: W * 0.4, size, role: T.heading, color: ink, maxLines: 1, name: "Brand" });
  }

  // ── Headline block (tilted as one unit) ────────────────────────────────
  const blockWidth = wide ? W * 0.44 : W * (tall ? 0.84 : 0.66);
  const blockX = wide ? m : (W - blockWidth) / 2;
  const blockTop = wide ? H * 0.2 : m + (C.brand ? scale.lead * 2.6 : 0) + u * 2;
  const first = ctx.nodes.length;
  let y = blockTop;
  if (C.eyebrow) {
    const eyebrowSize = Math.round(scale.h2 * (tall ? 1 : 0.95));
    const placed = text(ctx, C.eyebrow, { x: blockX, y, width: blockWidth, size: eyebrowSize, role: T.display, color: ink, maxLines: 1, align: wide ? "left" : "center", name: "Eyebrow" });
    y += placed.height;
  }
  const headlineMax = scale.hero * (tall ? 1 : orientation === "square" ? 0.56 : wide ? 0.72 : 0.88);
  const headline = fitHeadline(ctx, C.headline, C.emphasis, blockWidth, headlineMax, scale.h2, 3, C.emphasis ? 1.35 : 1);
  const headHeight = placeHeadline(ctx, headline, {
    x: blockX,
    y,
    width: blockWidth,
    align: wide ? "left" : "center",
    color: ink,
    emphasisColor: P.primary,
    background: P.bg,
    emphasisScale: C.emphasis ? 1.35 : 1,
  });
  y += headHeight;
  if (C.subhead) {
    const placed = text(ctx, C.subhead, { x: blockX, y: y + u, width: blockWidth, size: scale.lead, role: T.heading, color: ink, maxLines: 2, align: wide ? "left" : "center", name: "Subhead" });
    y += u + placed.height;
  }
  const headBottom = y;
  rotateGroup(ctx, first, { x: blockX + blockWidth / 2, y: (blockTop + headBottom) / 2 }, -4);

  // ── Footer geometry (bottom-up, so it can never fall off the page) ─────
  const phoneHeight = C.contact.phone ? scale.h2 * T.display.leading : C.details.length ? Math.min(3, C.details.length) * scale.body * 2 : 0;
  const ctaHeight = C.cta ? scale.body * 2.4 + u * 2 : 0;
  const webHeight = C.contact.website ? scale.caption * 1.4 : 0;
  const footerHeight = ctaHeight + phoneHeight + (phoneHeight ? u * 0.5 : 0) + webHeight;
  const footerTop = H - m - footerHeight;

  // ── Photo fan ──────────────────────────────────────────────────────────
  const border = { color: "#FFFFFF", width: Math.max(6, Math.round(u * 1.1)) };
  const fanTop = wide ? H * 0.14 : headBottom + u * (tall ? 8 : 6);
  const fanBottom = wide ? Math.min(H * 0.74, footerTop - u * 3) : footerTop - u * 5;
  const fanHeight = Math.max(H * 0.2, fanBottom - fanTop);
  const fanLeft = wide ? W * 0.5 : m;
  const fanWidth = wide ? W - m - fanLeft : W - 2 * m;
  const centerW = Math.min(fanWidth * 0.42, fanHeight * 0.82);
  const sideW = centerW * 0.74;
  const sideH = fanHeight * 0.72;
  const centerX = fanLeft + (fanWidth - centerW) / 2;

  // Accent bars and brackets sit behind and around the frames.
  rect(ctx, { x: fanLeft - u * 1.5, y: fanTop + fanHeight * 0.3, width: u * 3.2, height: fanHeight * 0.34 }, P.primary, { name: "Accent bar" });
  rect(ctx, { x: fanLeft + fanWidth - u * 1.7, y: fanTop + fanHeight * 0.18, width: u * 3.4, height: fanHeight * 0.3 }, P.dark, { name: "Accent bar" });
  rect(ctx, { x: centerX - u * 4, y: fanTop - u * 2.5, width: u * 7, height: u * 2.4 }, P.primary, { name: "Accent tab" });

  // Side frames only carry photos we actually have; otherwise they become colour cards,
  // so a design never ships with duplicate or empty side photos.
  const side = (index: number, x: number, frameY: number, rotation: number, fill: string) =>
    hasPhoto(ctx, index)
      ? photo(ctx, index, { x, y: frameY, width: sideW, height: sideH }, { rotation, stroke: border, shadow: true, name: "Photo" })
      : rect(ctx, { x, y: frameY, width: sideW, height: sideH }, fill, { rotation, stroke: border, shadow: { color: "rgba(0,0,0,0.22)", blur: u * 3, offsetX: 0, offsetY: u }, name: "Colour card" });
  side(1, fanLeft + u * 2, fanTop + fanHeight * 0.16, -5, P.tint);
  side(2, fanLeft + fanWidth - sideW - u * 2, fanTop + fanHeight * 0.12, 4, P.primary);
  photo(ctx, 0, { x: centerX, y: fanTop, width: centerW, height: fanHeight }, { rotation: -1.5, stroke: border, shadow: true, name: "Photo main" });

  const b = Math.round(u * 5);
  bracket(ctx, fanLeft + fanWidth * 0.84, fanTop - u * 1.5, b, u * 1.1, P.dark, "tr");
  bracket(ctx, fanLeft + u, fanTop + fanHeight * 0.9, b, u * 1.1, P.primary, "bl");
  bracket(ctx, fanLeft + fanWidth - b - u, fanTop + fanHeight * 0.86, b, u * 1.1, P.primary, "br");

  // ── Footer: CTA block + phone + web, social bottom-left ────────────────
  const footerRight = W - m;
  let footerY = footerTop;
  const footerWidth = wide ? W - 2 * m : W * 0.55;
  const footerX = footerRight - footerWidth;
  if (C.cta) {
    const size = scale.body;
    const label = C.cta;
    const width = Math.min(footerWidth, measure(label, styleOf(T.label, size)) + size * 3);
    rect(ctx, { x: footerRight - width, y: footerY, width, height: size * 2.4 }, P.primary, { cornerRadius: u * 0.4, name: "CTA" });
    text(ctx, label, { x: footerRight - width + size * 1.5, y: footerY + size * 0.7, width: width - size * 3, size, role: T.label, color: P.onPrimary, maxLines: 1, align: "center" });
    footerY += size * 2.4 + u * 2;
  }
  if (C.contact.phone) {
    const placed = text(ctx, C.contact.phone, { x: footerX, y: footerY, width: footerWidth, size: scale.h2, role: T.display, color: ink, maxLines: 1, align: "right", name: "Phone" });
    footerY += placed.height + u * 0.5;
  } else if (C.details.length) {
    const rows = C.details.slice(0, 3);
    footerY += iconRows(ctx, rows, footerX + footerWidth * 0.15, footerY, footerWidth * 0.85, scale.body, ink, accent);
  }
  if (C.contact.website) {
    text(ctx, C.contact.website, { x: footerX, y: footerY, width: footerWidth, size: scale.caption, role: T.label, color: muted, maxLines: 1, align: "right", name: "Website" });
  }
  const handle = C.contact.social[0] ?? (isShort(C.contact.email, 30) ? C.contact.email : null);
  if (handle) {
    const size = scale.body;
    icon(ctx, C.contact.social.length ? "at-sign" : "mail", m, H - m - size * 1.2, size * 1.2, P.primary);
    text(ctx, C.contact.social.length ? socialLine(ctx) : handle, { x: m + size * 1.7, y: H - m - size * 1.2, width: W * 0.4, size, role: T.heading, color: ink, maxLines: 1, name: "Social" });
  }
}
