import { alpha, contrast, CONTRAST } from "../color";
import {
  circle,
  contactLines,
  fitHeadline,
  inkOn,
  placeHeadline,
  rect,
  starburst,
  softOn,
  stack,
  styleOf,
  text,
  textHeight,
  type Block,
  type Ctx,
} from "../engine";
import { measure } from "../metrics";

/**
 * Swiss type: a purely typographic poster on a bold colour field — giant flush-left
 * headline, hairline rules, numbered detail rows and one large disc bleeding off the
 * edge for tension. Works with no photography at all.
 */
export function swissType(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  // A bright primary field when it can carry type, otherwise the palette's dark.
  const field = contrast(P.onPrimary, P.primary) >= CONTRAST.body ? P.primary : P.dark;
  ctx.background = field;
  // On the primary field use its designated text colour (white on red, etc.).
  const ink = field === P.primary ? P.onPrimary : inkOn(ctx, field);
  const soft = softOn(ink, field, 0.82);
  const rule = alpha(ink, 0.45);
  const disc = field === P.accent ? P.accent2 : P.accent;
  const wide = orientation === "landscape";

  // A numeric offer ("50%") becomes a starburst badge instead of headline emphasis —
  // unless the headline is little more than the number, where a badge just repeats it.
  const offer = C.emphasis && /\d/.test(C.emphasis) ? C.emphasis : null;
  const badge = offer && C.headline.replace(offer, "").replace(/\b(?:off|sale|now)\b/gi, "").trim().length > 6 ? offer : null;
  const firstContent = ctx.nodes.length;

  // ── Masthead ───────────────────────────────────────────────────────────
  const top = m;
  if (C.eyebrow) text(ctx, C.eyebrow, { x: m, y: top, width: W * 0.5, size: scale.caption, role: T.label, color: ink, maxLines: 1, name: "Eyebrow" });
  if (C.brand) text(ctx, C.brand, { x: W * 0.5, y: top, width: W * 0.5 - m, size: scale.caption, role: T.label, color: ink, maxLines: 1, align: "right", name: "Brand" });
  const ruleY = top + scale.caption * 2.2;
  rect(ctx, { x: m, y: ruleY, width: W - 2 * m, height: Math.max(2, u * 0.25) }, rule, { name: "Rule" });

  // ── Headline + supporting copy ─────────────────────────────────────────
  const width = W - 2 * m;
  // Short headlines ("50% OFF") are set huge; longer ones scale down to fit.
  const headline = fitHeadline(ctx, C.headline, badge ? null : C.emphasis, width, scale.hero * (C.headline.length <= 10 ? 1.9 : 1.35), scale.h2, wide ? 3 : 4);
  const columnWidth = wide ? W * 0.5 : W * 0.58;
  const blocks: Block[] = [
    {
      priority: 100,
      gapBefore: 0,
      height: () => headline.lines.length * headline.size * T.display.leading,
      render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: "left", color: ink, emphasisColor: disc, background: field }),
    },
  ];
  if (C.subhead) {
    blocks.push({
      priority: 70,
      gapBefore: u * 4,
      height: () => textHeight(C.subhead!, T.heading, scale.lead, columnWidth, 3),
      render: (x, y) => void text(ctx, C.subhead!, { x, y, width: columnWidth, size: scale.lead, role: T.heading, color: ink, maxLines: 3, name: "Subhead" }),
    });
  }
  if (C.body) {
    blocks.push({
      priority: 40,
      gapBefore: u * 2,
      height: () => textHeight(C.body!, T.body, scale.body, columnWidth, 4),
      render: (x, y) => void text(ctx, C.body!, { x, y, width: columnWidth, size: scale.body, role: T.body, color: soft, maxLines: 4, name: "Body" }),
    });
  }
  const rows = (C.details.length ? C.details.map((d) => d.text) : C.bullets).slice(0, 4);
  if (rows.length) {
    const rowHeight = scale.body * 2.4;
    blocks.push({
      priority: 60,
      gapBefore: u * 5,
      height: () => rows.length * rowHeight,
      render: (x, y) => {
        rows.forEach((row, i) => {
          const ry = y + i * rowHeight;
          rect(ctx, { x, y: ry, width: columnWidth, height: Math.max(1, u * 0.15) }, rule, { name: "Row rule" });
          text(ctx, String(i + 1).padStart(2, "0"), { x, y: ry + scale.body * 0.6, width: scale.body * 2.6, size: scale.body, role: T.label, color: disc === field ? ink : soft, maxLines: 1 });
          text(ctx, row, { x: x + scale.body * 2.8, y: ry + scale.body * 0.6, width: columnWidth - scale.body * 2.8, size: scale.body, role: T.heading, color: ink, maxLines: 1, name: "Detail" });
        });
      },
    });
  }

  const footerHeight = scale.body * 3.6;
  const content = stack({ x: m, y: ruleY + u * 6, width, height: H - m - footerHeight - (ruleY + u * 6) }, blocks, "top");

  // Disc + badge go only where the copy left room, and behind it in z-order.
  const free = H - content.bottom - u * 4;
  const discR = Math.max(Math.min(W, H) * 0.16, Math.min(Math.min(W, H) * (wide ? 0.42 : 0.38), free / 1.6));
  const discX = W - discR * 0.35;
  const discY = H - discR * 0.6;
  const behind = ctx.nodes.length;
  circle(ctx, discX, discY, discR, disc, { opacity: 0.95, name: "Disc" });
  const badgeR = Math.min(discR * 0.42, free * 0.34);
  const badgeY = Math.max(content.bottom + badgeR + u * 2, discY - discR * 0.42);
  // Only badge when it can be big enough to read and clear of the footer.
  if (badge && badgeR > Math.min(W, H) * 0.1 && badgeY + badgeR < H - m - footerHeight - u * 2) {
    const r = badgeR;
    const bx = discX - discR * 0.4;
    const by = badgeY;
    const badgeFill = P.dark === field ? P.primary : P.dark;
    starburst(ctx, bx, by, r, badgeFill);
    const size = Math.round(r * 0.5);
    text(ctx, badge, { x: bx - r * 0.75, y: by - size * 0.55, width: r * 1.5, size, role: T.display, color: inkOn(ctx, badgeFill, true), maxLines: 1, align: "center", name: "Badge" });
  }
  ctx.nodes.splice(firstContent, 0, ...ctx.nodes.splice(behind));

  // ── Footer ─────────────────────────────────────────────────────────────
  const footY = H - m - scale.body * 1.4;
  const contact = contactLines(C).slice(0, 2).map((line) => line.text).join("   ");
  if (contact) text(ctx, contact, { x: m, y: footY, width: W * 0.55, size: scale.body, role: T.heading, color: ink, maxLines: 1, name: "Contact" });
  if (C.cta) {
    const size = scale.body;
    const w = measure(C.cta, styleOf(T.label, size)) + size * 2.6;
    const pillFill = inkOn(ctx, disc, true) === ink ? field : ink;
    rect(ctx, { x: W - m - w, y: footY - size * 0.6, width: w, height: size * 2.4 }, pillFill, { cornerRadius: size * 1.2, name: "CTA" });
    text(ctx, C.cta, { x: W - m - w + size * 1.3, y: footY + size * 0.05, width: w - size * 2.6, size, role: T.label, color: inkOn(ctx, pillFill), maxLines: 1, align: "center" });
  }
}
