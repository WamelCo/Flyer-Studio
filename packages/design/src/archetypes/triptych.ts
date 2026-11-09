import { contrast, CONTRAST, mix } from "../color";
import { accentOn, contactLines, fitHeadline, hasPhoto, inkOn, photo, placeHeadline, rect, styleOf, text, textHeight, type Ctx, type DesignCopy } from "../engine";
import { measure } from "../metrics";

/** "Saturday 21 November" → { day: "21", month: "NOV" }; null when the copy states no day. */
export function dayAndMonth(copy: DesignCopy) {
  for (const d of copy.details) {
    const match = d.text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/i) ?? d.text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i);
    if (!match) continue;
    const [a, b] = [match[1]!, match[2]!];
    return /^\d/.test(a) ? { day: a.padStart(2, "0"), month: b.slice(0, 3).toUpperCase() } : { day: b.padStart(2, "0"), month: a.slice(0, 3).toUpperCase() };
  }
  return null;
}

/**
 * Triptych: three tall photo panels in a duotone of the palette, the centre one in full
 * colour and standing forward; the title set big above, the date running vertically
 * down both margins, and a date block beside a venue block at the foot. Concerts,
 * parties, tours, launches.
 */
export function triptych(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const field = P.dark;
  ctx.background = field;
  const lifted = mix(field, P.primary, 0.28);
  rect(ctx, { x: 0, y: 0, width: W, height: H }, "transparent", { gradient: { from: lifted, to: field }, name: "Background", locked: true });
  const wide = orientation === "landscape";
  const ink = inkOn(ctx, field, true);
  const title = [P.accent, P.primary, P.accent2, accentOn(ctx, field, true)].find((c) => contrast(c, lifted) >= CONTRAST.large && contrast(c, field) >= CONTRAST.large) ?? inkOn(ctx, lifted, true);
  const light = mix(P.primary, "#FFFFFF", 0.62);
  const duo = { tone: "duotone" as const, dark: field, light, grain: 0.18 };

  // ── Title ─────────────────────────────────────────────────────────────────
  const titleBox = wide ? { x: m, y: m, width: W * 0.36 - m, height: H * 0.5 } : { x: m, y: m * 0.8, width: W - 2 * m, height: H * 0.16 };
  const headline = fitHeadline(ctx, C.headline, C.emphasis, titleBox.width, scale.hero * (wide ? 1 : 1.2), scale.h2, wide ? 3 : 2, 1, titleBox.height);
  const headlineHeight = placeHeadline(ctx, headline, { x: titleBox.x, y: titleBox.y, width: titleBox.width, align: wide ? "left" : "center", color: title, emphasisColor: ink, background: [lifted, field] });
  let below = titleBox.y + headlineHeight;
  if (C.brand) {
    const size = Math.round(scale.h2 * 0.8);
    const placed = text(ctx, C.brand, { x: titleBox.x, y: below - size * 0.25, width: titleBox.width, size, role: T.script, color: ink, maxLines: 1, align: wide ? "left" : "right", name: "Script" });
    below += placed.height * 0.8;
  }

  // ── Panels ────────────────────────────────────────────────────────────────
  const blockHeight = scale.h1 * 1.25;
  const area = wide
    ? { x: W * 0.4, y: m * 0.7, width: W * 0.6 - m * 0.7, height: H - 1.4 * m }
    : { x: m, y: below + u * 4, width: W - 2 * m, height: H - m - blockHeight - u * 8 - (below + u * 4) };
  const gap = u * 1.6;
  const panelW = (area.width - 2 * gap) / 3;
  const frameFor = (i: number) => ({ x: area.x + i * (panelW + gap), y: area.y, width: panelW, height: area.height });
  // The same subject three ways, as a designer cuts one shoot: a close-up, the full frame, a mid crop.
  type Frame = { x: number; y: number; width: number; height: number };
  // Zoomed about the centre, a little above the middle where faces sit in most portraits.
  const zoom = (z: number) => (p: Frame) => ({ x: p.x - (p.width * (z - 1)) / 2, y: p.y - p.height * (z - 1) * 0.4, width: p.width * z, height: p.height * z });
  const crops = [zoom(1.7), undefined, zoom(1.3)];
  const panel = (i: number, frame: Frame, full: boolean) => {
    if (!hasPhoto(ctx, 0)) return rect(ctx, frame, i === 1 ? P.primary : mix(field, P.primary, 0.4), { cornerRadius: u * 0.6, name: "Panel" });
    return photo(ctx, 0, frame, { cornerRadius: u * 0.6, name: i === 1 ? "Photo main" : "Photo", fitFrame: crops[i]?.(frame), effects: full ? { grain: 0.1 } : duo, shadow: full });
  };
  panel(0, frameFor(0), false);
  panel(2, frameFor(2), false);
  // The centre stands forward: full colour, a little larger, casting a shadow.
  const centre = frameFor(1);
  panel(1, { x: centre.x - u * 1.5, y: centre.y - u * 2.5, width: centre.width + u * 3, height: centre.height + u * 5 }, true);

  // ── The date down both margins ────────────────────────────────────────────
  const date = C.details[0]?.text ?? C.eyebrow ?? null;
  if (date && !wide) {
    const size = scale.caption;
    const role = { ...T.label, tracking: Math.max(T.label.tracking ?? 0, 0.3) };
    const length = Math.min(area.height * 0.7, measure(date.toUpperCase(), styleOf(role, size)) + size);
    const left = text(ctx, date, { x: 0, y: 0, width: length, size, role, color: ink, maxLines: 1, name: "Microtype" });
    left.node.rotation = -90;
    left.node.x = Math.round((m - size * T.label.leading) / 2);
    left.node.y = Math.round(area.y + (area.height + length) / 2);
    const right = text(ctx, date, { x: 0, y: 0, width: length, size, role, color: ink, maxLines: 1, name: "Microtype" });
    right.node.rotation = 90;
    right.node.x = Math.round(W - (m - size * T.label.leading) / 2);
    right.node.y = Math.round(area.y + (area.height - length) / 2);
  }

  // ── Foot: the date block and the venue block ─────────────────────────────
  const foot = wide ? { x: m, y: H - m - blockHeight, width: W * 0.36 - m } : { x: m + panelW * 0.25, y: H - m - blockHeight, width: W - 2 * m - panelW * 0.5 };
  const when = dayAndMonth(C);
  const blockFill = contrast(P.onAccent, P.accent) >= CONTRAST.body ? P.accent : contrast(P.onPrimary, P.primary) >= CONTRAST.body ? P.primary : mix(P.accent, "#FFFFFF", 0.4);
  const blockInk = inkOn(ctx, blockFill, true);
  let x = foot.x;
  if (when) {
    const w = blockHeight * 0.95;
    rect(ctx, { x, y: foot.y, width: w, height: blockHeight }, blockFill, { name: "Date block" });
    text(ctx, when.month, { x: x + u, y: foot.y + u * 1.2, width: w - 2 * u, size: scale.body, role: T.label, color: blockInk, maxLines: 1, align: "center", name: "Month" });
    text(ctx, when.day, { x: x + u, y: foot.y + u * 1.2 + scale.body * 1.4, width: w - 2 * u, size: Math.round(blockHeight * 0.5), role: T.display, color: blockInk, maxLines: 1, align: "center", name: "Day" });
    x += w + u * 1.2;
  }
  const venue = C.details.find((d) => d.icon === "map-pin")?.text ?? C.details[1]?.text ?? C.subhead ?? null;
  const second = C.cta ?? contactLines(C)[0]?.text ?? null;
  if (venue || second) {
    const card = mix("#FFFFFF", blockFill, 0.15);
    const cardInk = inkOn(ctx, card, true);
    const w = foot.x + foot.width - x;
    rect(ctx, { x, y: foot.y, width: w, height: blockHeight }, card, { name: "Venue block" });
    const size = Math.round(scale.h3 * 1.1);
    const pad = u * 2;
    let y = foot.y + pad;
    if (venue) {
      const lines = textHeight(venue, T.display, size, w - 2 * pad, 2) > size * T.display.leading * 1.2 ? 2 : 1;
      y += text(ctx, venue, { x: x + pad, y, width: w - 2 * pad, size, role: T.display, color: cardInk, maxLines: lines, name: "Venue" }).height + u * 0.5;
    }
    if (second && y + scale.body * 1.4 < foot.y + blockHeight) text(ctx, second, { x: x + pad, y, width: w - 2 * pad, size: scale.body, role: T.label, color: cardInk, maxLines: 1, name: "CTA" });
  }
}
