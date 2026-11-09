import { headlineFigure, type Blocks } from "./shared";
import { contrast, CONTRAST } from "../color";
import {
  accentOn,
  circle,
  contactLines,
  dotGrid,
  fitHeadline,
  inkOn,
  mutedOn,
  path,
  placeHeadline,
  rect,
  stack,
  text,
  textHeight,
  type Ctx,
  type IconName,
} from "../engine";

/**
 * Ticket: the flyer is an admission ticket — a card with rounded corners, a perforated
 * tear line between notches, and a coloured stub carrying the call to action and a
 * barcode. Concerts, events, coupons, giveaways.
 */
/** Ticket field captions, from each detail's icon (labels, not facts). */
const FIELD_LABELS: Partial<Record<IconName, string>> = {
  calendar: "Date",
  clock: "Time",
  ticket: "Entry",
  "map-pin": "Venue",
  phone: "Call",
  globe: "Online",
  mail: "Email",
  tag: "Price",
  dollar: "Price",
  percent: "Offer",
  users: "Who",
  gift: "Prizes",
  utensils: "Food",
  headphones: "Music",
  mic: "Line-up",
};

export function ticket(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const wide = orientation === "landscape";
  const page = P.dark;
  ctx.background = page;
  // A paper card that stands clear of the page, whatever the palette (dark palettes get a light card).
  const card = [P.surface, P.bg, P.tint, P.onDark].find((c) => contrast(c, page) >= 4) ?? "#F6F1E7";
  const stub = contrast(P.onPrimary, P.primary) >= CONTRAST.body ? P.primary : P.accent;
  const ink = inkOn(ctx, card);
  const muted = mutedOn(ctx, card);
  const accent = accentOn(ctx, card, false);
  const stubInk = inkOn(ctx, stub, true);
  const stubSmall = inkOn(ctx, stub);

  const inset = Math.round(m * 0.75);
  const box = { x: inset, y: inset, width: W - 2 * inset, height: H - 2 * inset };
  const r = u * 3;
  const notch = u * 4.2;
  const pad = Math.round(m * 0.7);

  // ── The card and its stub ─────────────────────────────────────────────────
  let main: { x: number; y: number; width: number; height: number };
  let tear: { x: number; y: number; width: number; height: number };
  if (wide) {
    const cut = box.x + box.width * 0.7;
    rect(ctx, { x: box.x, y: box.y, width: cut - box.x + r, height: box.height }, card, { cornerRadius: r, name: "Ticket" });
    rect(ctx, { x: cut, y: box.y, width: box.x + box.width - cut, height: box.height }, stub, { cornerRadius: r, name: "Stub" });
    circle(ctx, cut, box.y, notch, page, { name: "Notch" });
    circle(ctx, cut, box.y + box.height, notch, page, { name: "Notch" });
    const dots = Math.floor((box.height - notch * 3) / (u * 2.2));
    dotGrid(ctx, cut - u * 0.4, box.y + notch * 1.5, 1, dots, u * 2.2, u * 0.4, page, 1);
    main = { x: box.x + pad, y: box.y + pad, width: cut - box.x - 2 * pad, height: box.height - 2 * pad };
    tear = { x: cut + pad * 0.8, y: box.y + pad, width: box.x + box.width - cut - pad * 1.6, height: box.height - 2 * pad };
  } else {
    const cut = box.y + box.height * (orientation === "square" ? 0.68 : 0.72);
    rect(ctx, { x: box.x, y: box.y, width: box.width, height: cut - box.y + r }, card, { cornerRadius: r, name: "Ticket" });
    rect(ctx, { x: box.x, y: cut, width: box.width, height: box.y + box.height - cut }, stub, { cornerRadius: r, name: "Stub" });
    circle(ctx, box.x, cut, notch, page, { name: "Notch" });
    circle(ctx, box.x + box.width, cut, notch, page, { name: "Notch" });
    const dots = Math.floor((box.width - notch * 3) / (u * 2.2));
    dotGrid(ctx, box.x + notch * 1.5, cut - u * 0.4, dots, 1, u * 2.2, u * 0.4, page, 1);
    main = { x: box.x + pad, y: box.y + pad, width: box.width - 2 * pad, height: cut - box.y - 2 * pad };
    tear = { x: box.x + pad, y: cut + pad * 0.8, width: box.width - 2 * pad, height: box.y + box.height - cut - pad * 1.6 };
  }

  // ── Main: masthead row, headline, subhead, body ───────────────────────────
  const rowHeight = scale.caption * T.label.leading;
  if (C.eyebrow) text(ctx, C.eyebrow, { x: main.x, y: main.y, width: main.width * 0.55, size: scale.caption, role: T.label, color: accent, maxLines: 1, name: "Eyebrow" });
  if (C.brand) text(ctx, C.brand, { x: main.x + main.width * 0.45, y: main.y, width: main.width * 0.55, size: scale.caption, role: T.label, color: ink, maxLines: 1, align: "right", name: "Brand" });
  const top = C.eyebrow || C.brand ? main.y + rowHeight + u * 4 : main.y;

  // Details as labelled ticket fields (Date, Time, Entry, Venue…) along the foot of the card.
  const fields = C.details.slice(0, 4).map((d) => ({ label: FIELD_LABELS[d.icon] ?? "Details", value: d.text }));
  const columns = Math.min(fields.length, wide ? 3 : 2);
  const fieldGap = u * 4;
  const columnWidth = columns ? (main.width - (columns - 1) * fieldGap) / columns : 0;
  const labelHeight = scale.caption * T.label.leading;
  const rowsOfFields = Array.from({ length: Math.ceil(fields.length / Math.max(1, columns)) }, (_, r) => fields.slice(r * columns, r * columns + columns));
  const rowHeights = rowsOfFields.map((row) => Math.max(...row.map((f) => labelHeight + u * 0.8 + textHeight(f.value, T.heading, scale.lead, columnWidth, 2))));
  const fieldsHeight = rowHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, rowHeights.length - 1) * u * 3;
  const fieldsTop = main.y + main.height - fieldsHeight;
  const region = { x: main.x, y: top, width: main.width, height: (fields.length ? fieldsTop - u * 6 : main.y + main.height) - top };
  if (fields.length && region.height > scale.h2 * 2) {
    rect(ctx, { x: main.x, y: fieldsTop - u * 3, width: main.width, height: Math.max(1, Math.round(u * 0.15)) }, muted, { name: "Rule" });
    let y = fieldsTop;
    rowsOfFields.forEach((row, r) => {
      row.forEach((field, c) => {
        const x = main.x + c * (columnWidth + fieldGap);
        text(ctx, field.label, { x, y, width: columnWidth, size: scale.caption, role: T.label, color: accent, maxLines: 1, name: "Field label" });
        text(ctx, field.value, { x, y: y + labelHeight + u * 0.8, width: columnWidth, size: scale.lead, role: T.heading, color: ink, maxLines: 2, name: "Detail" });
      });
      y += rowHeights[r]! + u * 3;
    });
  } else if (fields.length) {
    region.height = main.y + main.height - top;
  }

  const headline = fitHeadline(ctx, C.headline, C.emphasis, region.width, scale.hero * (wide ? 1.35 : orientation === "square" ? 0.95 : 1.25), scale.h2, 3, 1, region.height * 0.72);
  stack(
    region,
    [
      {
        priority: 100,
        gapBefore: 0,
        height: () => headline.lines.length * headline.size * T.display.leading,
        render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: "left", color: ink, emphasisColor: P.primary, background: card }),
      },
      C.subhead && {
        priority: 70,
        gapBefore: u * 2.5,
        height: (w: number) => textHeight(C.subhead!, T.heading, scale.lead, w, 2),
        render: (x: number, y: number, w: number) => void text(ctx, C.subhead!, { x, y, width: w, size: scale.lead, role: T.heading, color: muted, maxLines: 2, name: "Subhead" }),
      },
      C.body && {
        priority: 35,
        gapBefore: u * 3,
        height: (w: number) => textHeight(C.body!, T.body, scale.body, w, 3),
        render: (x: number, y: number, w: number) => void text(ctx, C.body!, { x, y, width: w, size: scale.body, role: T.body, color: muted, maxLines: 3, name: "Body" }),
      },
    ],
    // With fields the title sits at the head and the fields at the foot; alone, it takes the centre.
    fields.length ? "top" : "center",
  );

  // ── Stub: the call (or the figure), contact, barcode ─────────────────────
  const figure = headlineFigure(C);
  const call = C.cta ?? figure;
  const contact = contactLines(C)[0]?.text ?? C.contact.social[0] ?? null;
  const barcodeWidth = wide ? tear.width : Math.min(tear.width * 0.34, W * 0.24);
  const textWidth = wide ? tear.width : tear.width - barcodeWidth - u * 4;
  const callSize = Math.round(Math.min(scale.h1, wide ? scale.h2 : scale.h1 * 0.8));
  const blocks: Blocks = [
    call && {
      priority: 100,
      gapBefore: 0,
      height: (w: number) => textHeight(call, T.display, callSize, w, 2),
      render: (x: number, y: number, w: number) => void text(ctx, call, { x, y, width: w, size: callSize, role: T.display, color: stubInk, maxLines: 2, name: C.cta ? "CTA" : "Figure" }),
    },
    contact && {
      priority: 60,
      gapBefore: u * 2,
      height: () => scale.body * T.label.leading,
      render: (x: number, y: number, w: number) => void text(ctx, contact, { x, y, width: w, size: scale.body, role: T.label, color: stubSmall, maxLines: 1, name: "Contact" }),
    },
  ];
  const barcodeHeight = wide ? Math.min(tear.height * 0.22, u * 9) : tear.height;
  const textRegion = wide ? { x: tear.x, y: tear.y, width: textWidth, height: tear.height - barcodeHeight - u * 4 } : { x: tear.x, y: tear.y, width: textWidth, height: tear.height };
  if (blocks.some(Boolean)) stack(textRegion, blocks, "center");

  // A decorative barcode: bar widths seeded by the headline, so it never changes between renders.
  const bx = wide ? tear.x : tear.x + tear.width - barcodeWidth;
  const by = wide ? tear.y + tear.height - barcodeHeight : tear.y;
  const seed = [...C.headline].map((ch) => ch.charCodeAt(0));
  let d = "";
  let cursor = 0;
  for (let i = 0; ; i++) {
    const bar = u * (0.4 + ((seed[i % seed.length]! + i * 7) % 5) * 0.35);
    if (cursor + bar > barcodeWidth) break;
    d += `M${cursor.toFixed(1)} 0h${bar.toFixed(1)}v${barcodeHeight.toFixed(1)}h${(-bar).toFixed(1)}Z`;
    cursor += bar + u * (0.55 + ((seed[(i + 3) % seed.length]! % 3) * 0.3));
  }
  // One shape, not dozens: a single "Barcode" layer in the editor.
  if (d) path(ctx, [d], [barcodeWidth, barcodeHeight], { x: bx, y: by, width: barcodeWidth, height: barcodeHeight }, { fill: stubSmall }, { name: "Barcode" });
}
