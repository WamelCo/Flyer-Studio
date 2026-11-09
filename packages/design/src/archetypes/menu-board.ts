import { ctaHeight, ctaPill, joinDetails, splitPrice, type Blocks } from "./shared";
import { alpha } from "../color";
import {
  accentOn,
  contactLines,
  dotGrid,
  fitHeadline,
  inkOn,
  mutedOn,
  placeHeadline,
  rect,
  stack,
  styleOf,
  text,
  textHeight,
  type Ctx,
  type DesignCopy,
} from "../engine";
import { measure } from "../metrics";

interface Item {
  name: string;
  price: string | null;
  note: string | null;
}

/** The list a menu or price board shows: features (name + note) or bullets, prices as written. */
export function menuItems(copy: DesignCopy): Item[] {
  const features = copy.features.map((f) => {
    const split = splitPrice(f.title);
    const fromText = split.price ? null : splitPrice(f.text);
    return { name: split.name, price: split.price ?? fromText?.price ?? null, note: (fromText?.price ? fromText.name : f.text) || null };
  });
  const bullets = copy.bullets.map((b) => ({ ...splitPrice(b), note: null }));
  // The list that carries prices is the menu; selling points elsewhere are not.
  const priced = (list: Item[]) => list.filter((item) => item.price).length;
  if (priced(bullets) > priced(features)) return bullets;
  return features.length >= 2 ? features : bullets;
}

/**
 * Menu / price list: a framed board — header, then items with dotted leaders running to
 * their prices (as written; never invented), an optional note under each, details and
 * the call to action at the foot. Two columns when the list is long and the page wide.
 */
export function menuBoard(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  ctx.background = P.bg;
  const ink = inkOn(ctx, P.bg);
  const muted = mutedOn(ctx, P.bg);
  const accent = accentOn(ctx, P.bg, false);
  const wide = orientation === "landscape";
  const items = menuItems(C).slice(0, wide ? 8 : orientation === "tall" ? 9 : 8);

  const inset = Math.round(m * 0.45);
  rect(ctx, { x: inset, y: inset, width: W - 2 * inset, height: H - 2 * inset }, "transparent", { stroke: { color: alpha(ink, 0.3), width: Math.max(1, Math.round(u * 0.2)) }, name: "Frame", locked: true });

  // ── Header ────────────────────────────────────────────────────────────────
  const width = W - 2 * m;
  const headline = fitHeadline(ctx, C.headline, C.emphasis, width * (wide ? 0.7 : 0.9), scale.hero * (wide ? 0.8 : 0.95), scale.h2, 2);
  const headerHeight =
    (C.eyebrow ? scale.body * T.label.leading + u * 2 : 0) +
    headline.lines.length * headline.size * T.display.leading +
    (C.subhead ? u * 2 + textHeight(C.subhead, T.heading, scale.lead, width * 0.8, 1) : 0);
  let y = m;
  if (C.eyebrow) {
    text(ctx, C.eyebrow, { x: m, y, width, size: scale.body, role: T.label, color: accent, maxLines: 1, align: "center", name: "Eyebrow" });
    y += scale.body * T.label.leading + u * 2;
  }
  y += placeHeadline(ctx, headline, { x: m + (width - width * (wide ? 0.7 : 0.9)) / 2, y, width: width * (wide ? 0.7 : 0.9), align: "center", color: ink, emphasisColor: P.primary, background: P.bg });
  if (C.subhead) text(ctx, C.subhead, { x: m + width * 0.1, y: y + u * 2, width: width * 0.8, size: scale.lead, role: T.heading, color: muted, maxLines: 1, align: "center", name: "Subhead" });
  const listTop = m + headerHeight + u * 6;
  rect(ctx, { x: W / 2 - W * 0.05, y: listTop - u * 3, width: W * 0.1, height: Math.max(2, u * 0.3) }, accent, { name: "Divider" });

  // ── Footer (bottom-up) ────────────────────────────────────────────────────
  const contact = contactLines(C)
    .slice(0, 2)
    .map((l) => l.text)
    .join("   ·   ");
  const footer: Blocks = [
    C.details.length > 0 && {
      priority: 60,
      gapBefore: 0,
      height: (w) => textHeight(joinDetails(ctx), T.label, scale.body, w, 2),
      render: (x, by, w) => void text(ctx, joinDetails(ctx), { x, y: by, width: w, size: scale.body, role: T.label, color: ink, maxLines: 2, align: "center", name: "Details" }),
    },
    C.cta && {
      priority: 50,
      gapBefore: u * 3,
      height: () => ctaHeight(ctx),
      render: (x, by, w) => void ctaPill(ctx, C.cta!, { x: x + w / 2, y: by, color: P.primary, align: "center", maxWidth: w }),
    },
    contact && {
      priority: 40,
      gapBefore: u * 3,
      height: () => scale.caption * T.label.leading,
      render: (x, by, w) => void text(ctx, contact, { x, y: by, width: w, size: scale.caption, role: T.label, color: muted, maxLines: 1, align: "center", name: "Contact" }),
    },
  ];
  const footerRegion = { x: m, y: listTop, width, height: H - m - listTop };
  const placedFooter = stack({ ...footerRegion, y: H - m - footerRegion.height * 0.32, height: footerRegion.height * 0.32 }, footer, "bottom");
  const listBottom = placedFooter.top - u * 6;

  // ── The list ──────────────────────────────────────────────────────────────
  // One column reads best on tall pages; two only when the list is long for the page.
  const columns = items.length > (wide || orientation === "square" ? 5 : 8) ? 2 : 1;
  const gutter = u * 7;
  const colWidth = (width - (columns - 1) * gutter) / columns;
  const nameSize = scale.lead;
  const noteSize = scale.body;
  const itemHeight = (item: Item) => nameSize * T.heading.leading + (item.note ? u * 0.6 + textHeight(item.note, T.body, noteSize, colWidth * 0.8, 2) : 0);
  const available = listBottom - listTop;
  const baseGap = u * 3.5;
  const split = (list: Item[]) => {
    const per = Math.ceil(list.length / columns);
    return Array.from({ length: columns }, (_, c) => list.slice(c * per, (c + 1) * per));
  };
  const height = (column: Item[], gap: number) => column.reduce((sum, item) => sum + itemHeight(item), 0) + Math.max(0, column.length - 1) * gap;
  // Drop items from the end until every column fits: a designer cuts the list, never crams it.
  let fit = items;
  while (fit.length > 1 && split(fit).some((column) => height(column, baseGap) > available)) fit = fit.slice(0, -1);
  const cols = split(fit);
  const most = Math.max(...cols.map((column) => column.length));
  const tallest = Math.max(...cols.map((column) => height(column, 0)));
  // Spare room opens the rhythm, up to a point.
  const spacing = most > 1 ? Math.min(u * 8, Math.max(baseGap, (available - tallest) / (most - 1))) : 0;
  // The list sits centred in its band, so a short menu doesn't huddle under the header.
  const used = Math.max(...cols.map((column) => height(column, spacing)));
  const start = listTop + Math.max(0, (available - used) / 2);

  cols.forEach((column, c) => {
    const x = m + c * (colWidth + gutter);
    let iy = start;
    for (const item of column) {
      renderItem(item, x, iy);
      iy += itemHeight(item) + spacing;
    }
  });

  function renderItem(item: Item, x: number, iy: number) {
    const price = item.price;
    const priceWidth = price ? measure(price, styleOf(T.heading, nameSize)) + nameSize * 0.3 : 0;
    const nameWidth = Math.min(measure(item.name, styleOf(T.heading, nameSize)) + nameSize * 0.3, colWidth - priceWidth - u * 4);
    text(ctx, item.name, { x, y: iy, width: nameWidth, size: nameSize, role: T.heading, color: ink, maxLines: 1, name: "Item" });
    if (price) {
      text(ctx, price, { x: x + colWidth - priceWidth, y: iy, width: priceWidth, size: nameSize, role: T.heading, color: accent, maxLines: 1, align: "right", name: "Price" });
      // Dotted leader between name and price.
      const from = x + nameWidth + u * 1.5;
      const to = x + colWidth - priceWidth - u * 1.5;
      const gap = u * 1.4;
      const dots = Math.floor((to - from) / gap);
      if (dots > 2) dotGrid(ctx, from, iy + nameSize * T.heading.leading * 0.62, dots, 1, gap, Math.max(1, u * 0.22), muted, 1);
    }
    if (item.note) text(ctx, item.note, { x, y: iy + nameSize * T.heading.leading + u * 0.6, width: colWidth * 0.8, size: noteSize, role: T.body, color: muted, maxLines: 2, name: "Item note" });
  }
}
