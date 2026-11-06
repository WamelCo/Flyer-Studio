import { isShort, socialLine } from "@/lib/design/archetypes/shared";
import { mix } from "@/lib/design/color";
import {
  accentOn,
  circle,
  contactLines,
  crossMark,
  dotGrid,
  fitHeadline,
  iconChip,
  iconRows,
  iconRowsHeight,
  inkOn,
  mutedOn,
  photo,
  placeHeadline,
  rect,
  ring,
  stack,
  styleOf,
  text,
  textHeight,
  type Block,
  type Ctx,
} from "@/lib/design/engine";
import { measure } from "@/lib/design/metrics";

/**
 * Editorial split (corporate reference): headline column left, circular hero photo with
 * a sweeping ring arc right, floating chips, then a "why us" column and a feature list.
 */
export function editorialSplit(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  ctx.background = P.bg;
  const ink = inkOn(ctx, P.bg);
  const muted = mutedOn(ctx, P.bg);
  const accent = accentOn(ctx, P.bg, false);
  const wide = orientation === "landscape";
  const tall = orientation === "tall";
  const square = orientation === "square";

  // ── Hero photo geometry ────────────────────────────────────────────────
  const D = Math.round(wide ? H * 0.6 : tall ? W * 0.58 : W * (square ? 0.4 : 0.46));
  const cx = wide ? W - m - D * 0.62 : tall ? W * 0.58 : W - m - D * 0.5;
  const cy = wide ? H * 0.47 : tall ? m + H * 0.05 + D * 0.62 : m + D * (square ? 0.66 : 0.72);

  // Soft colour field behind the portrait, then the photo, then the arc that wraps it.
  circle(ctx, cx - D * 0.06, cy + D * 0.06, D * 0.55, P.tint, { name: "Colour field" });
  dotGrid(ctx, cx - D * 0.66, cy - D * 0.6, 5, 4, u * 2, u * 0.32, P.accent, 0.75);
  dotGrid(ctx, cx + D * 0.3, cy + D * 0.44, 5, 4, u * 2, u * 0.32, P.accent, 0.75);
  photo(ctx, 0, { x: cx - D / 2, y: cy - D / 2, width: D, height: D }, { cornerRadius: D / 2, name: "Hero photo" });
  ring(ctx, cx, cy, D * 0.6, D * 0.075, P.primary, 25, 185);

  // Floating chips pin the photo into the composition (kept inside the page).
  const chip = Math.round(u * 6.5);
  iconChip(ctx, C.features[0]?.icon ?? "bar-chart", Math.min(cx + D * 0.38, W - m - chip), cy - D * 0.44, chip, P.primary, P.onPrimary);
  iconChip(ctx, C.features[1]?.icon ?? "check", cx - D * 0.5, cy - D * 0.4, Math.round(chip * 0.78), P.accent2, inkOn(ctx, P.accent2), true);
  const tag = C.bullets.find((b) => isShort(b, 14));
  if (tag) {
    const size = scale.caption;
    const width = measure(tag, styleOf(T.label, size)) + size * 2;
    const x = Math.min(cx + D * 0.18, W - m - width);
    const y = cy + D * 0.36;
    rect(ctx, { x, y, width, height: size * 2 }, P.accent2, { cornerRadius: size, name: "Tag" });
    text(ctx, tag, { x: x + size, y: y + size * 0.4, width: width - size * 2, size, role: T.label, color: inkOn(ctx, P.accent2) });
  }
  crossMark(ctx, cx + D * 0.06, cy - D * 0.64, u * 2.2, ink);
  crossMark(ctx, Math.min(cx + D * 0.64, W - m), cy + D * 0.2, u * 1.8, ink);

  // ── Top row: call-to-action + phone left, wordmark right ───────────────
  let topBottom = m;
  const phone = C.contact.phone;
  const topLabel = phone ? (C.cta ?? "Call us") : C.eyebrow;
  if (topLabel) {
    const label = text(ctx, topLabel, { x: m, y: m, width: W * 0.4, size: scale.caption, role: T.heading, color: ink, maxLines: 1 });
    topBottom = m + label.height;
    if (phone) {
      const placed = text(ctx, phone, { x: m, y: topBottom + u * 0.4, width: W * 0.4, size: scale.lead, role: T.heading, color: ink, maxLines: 1 });
      topBottom += u * 0.4 + placed.height;
    }
  }
  if (C.brand) {
    const size = scale.h3;
    const brandWidth = Math.min(measure(C.brand, styleOf(T.emphasis, size)), W * 0.3);
    text(ctx, C.brand, { x: W - m - brandWidth, y: m, width: brandWidth, size, role: T.emphasis, color: ink, maxLines: 1, align: "right", name: "Brand" });
    circle(ctx, W - m - brandWidth * 0.32, m - size * 0.06, size * 0.11, P.primary, { name: "Brand dot" });
  }

  const contact = contactLines(C).filter((line) => line.icon !== "phone" || !phone);
  const headlineBlock = (maxSize: number, width: number, maxHeight = Infinity): Block => {
    const headline = fitHeadline(ctx, C.headline, C.emphasis, width, maxSize, scale.h2, 4, 1, maxHeight);
    return {
      priority: 100,
      gapBefore: 0,
      height: () => headline.lines.length * headline.size * T.display.leading,
      render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: "left", color: ink, emphasisColor: ink, background: P.bg }),
    };
  };
  const subheadBlock: Block | null = C.subhead
    ? {
        priority: 60,
        gapBefore: u * 2.5,
        height: (width) => textHeight(C.subhead!, T.heading, scale.body, width, 2),
        render: (x, y, width) => void text(ctx, C.subhead!, { x, y, width, size: scale.body, role: T.heading, color: ink, maxLines: 2, name: "Subhead" }),
      }
    : null;
  const contactBlock: Block | null =
    contact.length || C.contact.social.length
      ? {
          priority: 30,
          gapBefore: u * 5,
          height: (width) => iconRowsHeight(ctx, contact, width, scale.caption) + (C.contact.social.length ? scale.caption * 1.6 : 0),
          render: (x, y, width) => {
            const h = iconRows(ctx, contact, x, y, width, scale.caption, muted, accent);
            if (C.contact.social.length) text(ctx, socialLine(ctx), { x, y: y + h + scale.caption * 0.3, width, size: scale.caption, role: T.heading, color: ink, maxLines: 1 });
          },
        }
      : null;

  if (wide || tall) {
    // One flowing column under (tall) or beside (wide) the portrait.
    const x = m;
    const top = tall ? cy + D * 0.68 : topBottom + u * 4;
    const width = tall ? W - 2 * m : cx - D * 0.72 - m;
    const blocks: (Block | null)[] = [headlineBlock(scale.h1 * (tall ? 1.1 : 1.15), width), subheadBlock, ...whyBlocks(ctx, ink, muted), ...featureBlocks(ctx, ink, muted, tall ? 3 : 2), contactBlock];
    stack({ x, y: top, width, height: H - m - top }, blocks, "justify");
    return;
  }

  // ── Headline column beside the portrait ────────────────────────────────
  const columnWidth = cx - D / 2 - m - u * 3;
  const headTop = topBottom + u * 5;
  const headBottom = cy + D * 0.5;
  stack({ x: m, y: headTop, width: columnWidth, height: headBottom - headTop }, [headlineBlock(scale.h1 * 1.05, columnWidth, headBottom - headTop - scale.body * 3), subheadBlock], "center");

  // ── Lower band: why-us + contact left, features right ──────────────────
  const lowerTop = cy + D * 0.66 + u * 3;
  const bottom = H - m;
  const leftWidth = W * 0.4;
  const rightX = m + leftWidth + u * 6;
  const rightWidth = W - m - rightX;
  const why = whyBlocks(ctx, ink, muted);
  const contactHeight = contactBlock ? contactBlock.height(leftWidth) : 0;
  stack({ x: m, y: lowerTop, width: leftWidth, height: bottom - lowerTop - contactHeight - u * 4 }, why, "top");
  if (contactBlock) contactBlock.render(m, bottom - contactHeight, leftWidth);

  const features = featureBlocks(ctx, ink, muted, square ? 2 : 3);
  if (features.length) {
    stack({ x: rightX, y: lowerTop + scale.lead * 1.6, width: rightWidth, height: bottom - lowerTop - scale.lead * 1.6 }, features, "justify");
  } else if (C.details.length) {
    iconRows(ctx, C.details.slice(0, 4), rightX, lowerTop + scale.lead * 1.6, rightWidth, scale.body, ink, accent);
  }

  // Quiet geometric ballast at the foot of the page, like the reference's grey arcs.
  const ballast = mix(P.bg, P.ink, 0.1);
  circle(ctx, W * 0.42, H + W * 0.03, W * 0.075, ballast, { name: "Ballast" });
  circle(ctx, W * 0.5, H + W * 0.045, W * 0.06, P.tint, { name: "Ballast", opacity: 0.9 });
  crossMark(ctx, W - m - u * 6, H - m * 0.55, u * 1.6, ink);
}

function whyBlocks(ctx: Ctx, ink: string, muted: string): Block[] {
  const { u, scale, type: T, copy: C, palette: P } = ctx;
  const blocks: Block[] = [];
  if (C.bodyTitle) {
    blocks.push({
      priority: 40,
      gapBefore: u * 5,
      height: (width) => textHeight(C.bodyTitle!, T.heading, scale.lead, width, 2),
      render: (x, y, width) => void text(ctx, C.bodyTitle!, { x, y, width, size: scale.lead, role: T.heading, color: ink, maxLines: 2, name: "Section title" }),
    });
  }
  if (C.body) {
    blocks.push({
      priority: 45,
      gapBefore: u * 2,
      height: (width) => textHeight(C.body!, T.body, scale.body, width, 5),
      render: (x, y, width) => void text(ctx, C.body!, { x, y, width, size: scale.body, role: T.body, color: muted, maxLines: 5, name: "Body" }),
    });
  }
  const bullets = C.bullets.slice(0, 4);
  if (bullets.length) {
    const lineHeight = scale.body * 1.7;
    blocks.push({
      priority: 35,
      gapBefore: u * 3,
      height: () => bullets.length * lineHeight,
      render: (x, y, width) => {
        bullets.forEach((bullet, i) => {
          const r = scale.body * 0.3;
          circle(ctx, x + r, y + i * lineHeight + scale.body * 0.72, r, "transparent", { stroke: { color: P.primary, width: Math.max(2, r * 0.45) }, name: "Bullet" });
          text(ctx, bullet, { x: x + r * 2 + scale.body * 0.7, y: y + i * lineHeight, width: width - r * 2 - scale.body * 0.7, size: scale.body, role: T.body, color: ink, maxLines: 1 });
        });
      },
    });
  }
  return blocks;
}

function featureBlocks(ctx: Ctx, ink: string, muted: string, limit: number): Block[] {
  const { u, scale, type: T, copy: C, palette: P } = ctx;
  return C.features.slice(0, limit).map((feature, i) => {
    const chip = Math.round(scale.body * 1.5);
    const indent = chip + scale.body * 0.7;
    return {
      priority: 25 - i,
      gapBefore: u * 4,
      height: (width: number) => scale.lead * 1.3 + u + textHeight(feature.text, T.body, scale.body, width - indent, 3),
      render: (x: number, y: number, width: number) => {
        iconChip(ctx, feature.icon, x, y, chip, P.tint, P.primary);
        text(ctx, feature.title, { x: x + indent, y: y + (chip - scale.lead * 1.25) / 2, width: width - indent, size: scale.lead, role: T.heading, color: ink, maxLines: 1, name: "Feature" });
        text(ctx, feature.text, { x: x + indent, y: y + scale.lead * 1.3 + u, width: width - indent, size: scale.body, role: T.body, color: muted, maxLines: 3 });
      },
    };
  });
}
