import { ctaPill, socialLine, type Blocks } from "./shared";
import { alpha, contrast, CONTRAST, mix } from "../color";
import { accentOn, contactLines, fitHeadline, hasPhoto, icon, inkOn, path, photo, placeHeadline, rect, softOn, stack, styleOf, text, textHeight, type Ctx } from "../engine";
import { measure } from "../metrics";

/**
 * Focus window: the portrait blurred, black-and-white and grainy across the whole page,
 * with a sharp full-colour strip of the same photo in a hairline frame — the eye goes
 * straight to it. The headline crosses into the strip; microtype, a crosshair and a
 * corner square finish it like a designer's poster.
 */
export function focusWindow(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const field = P.dark;
  ctx.background = field;
  const wide = orientation === "landscape";
  const tall = orientation === "tall";
  const page = { x: 0, y: 0, width: W, height: H };
  const photographed = hasPhoto(ctx, 0);

  // ── The strip ──────────────────────────────────────────────────────────────
  const win = wide
    ? { x: W * 0.5, y: H * 0.1, width: W * 0.2, height: H * 0.8 }
    : tall
      ? { x: W * 0.4, y: H * 0.17, width: W * 0.34, height: H * 0.54 }
      : { x: W * 0.42, y: H * 0.1, width: W * (orientation === "square" ? 0.28 : 0.31), height: H * (orientation === "square" ? 0.74 : 0.66) };
  const veil = mix(field, P.primary, 0.3);
  const windowFill = contrast("#FFFFFF", veil) >= CONTRAST.large ? veil : field;
  if (photographed) {
    photo(ctx, 0, page, { name: "Background photo", effects: { tone: "mono", blur: u * 1.7, dim: 0.58, grain: 0.35 }, locked: true });
    // A veil, heavier at the foot where the contact sits: drama whatever the photo's backdrop.
    rect(ctx, page, "transparent", { gradient: { from: alpha(field, 0.2), to: alpha(field, 0.72) }, name: "Veil", locked: true });
    photo(ctx, 0, win, { name: "Focus window", fitFrame: page, effects: { grain: 0.12 } });
  } else {
    rect(ctx, win, windowFill, { name: "Focus window" });
  }
  const hair = Math.max(2, Math.round(u * 0.25));
  rect(ctx, win, "transparent", { stroke: { color: "#FFFFFF", width: hair }, name: "Frame" });

  const ink = inkOn(ctx, field, true);
  const soft = softOn(ink, field, 0.86);
  // Type may cross the strip, so accents must read on it as well as on the field.
  const behind = photographed ? [field] : [field, windowFill];
  const fieldAccent = accentOn(ctx, field, false);
  const accent = behind.every((bg) => contrast(fieldAccent, bg) >= CONTRAST.body) ? fieldAccent : ink;
  const shade = { color: "rgba(0,0,0,0.6)", blur: Math.round(u * 3), offsetX: 0, offsetY: Math.round(u * 0.4) };

  // ── Marks: a crosshair and a small square, as on a proof sheet ─────────────
  const cross = u * 5;
  path(ctx, ["M12 1V23M1 12H23"], [24, 24], { x: m * 0.6, y: m * 0.6, width: cross, height: cross }, { stroke: { color: ink, width: 1.4 } }, { name: "Crosshair" });
  rect(ctx, { x: W - m * 0.6 - u * 4, y: H - m * 0.6 - u * 4, width: u * 4, height: u * 4 }, "transparent", { stroke: { color: ink, width: hair }, name: "Mark" });

  // ── Headline crossing into the strip ──────────────────────────────────────
  // The headline crosses a third of the way into the strip: enough to bind them, not to bury the type.
  const right = win.x + win.width * (wide ? 0.4 : 0.3);
  const columnWidth = right - m;
  const top = win.y + win.height * 0.1;
  const headline = fitHeadline(ctx, C.headline, C.emphasis, columnWidth, scale.hero * (wide ? 1.15 : tall ? 1.05 : 1.25), scale.h2, 3, 1, win.height * 0.42);
  const first = ctx.nodes.length;
  const date = C.details[0]?.text ?? null;
  const head = stack(
    { x: m, y: top, width: columnWidth, height: win.height * 0.62 },
    [
      C.eyebrow && {
        priority: 60,
        gapBefore: 0,
        height: () => scale.body * T.label.leading,
        render: (x, y, w) => void text(ctx, C.eyebrow!, { x, y, width: w, size: scale.body, role: T.label, color: accent, maxLines: 1, align: "right", name: "Eyebrow" }),
      },
      {
        priority: 100,
        gapBefore: u * 1.5,
        height: () => headline.lines.length * headline.size * T.display.leading,
        render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: "right", color: ink, emphasisColor: P.primary, background: behind }),
      },
      (C.subhead || date) && {
        priority: 70,
        gapBefore: u * 1.5,
        height: () => scale.body * T.label.leading,
        render: (x, y, w) => {
          // The ref's "IN PEACE ……… 07.08.26" line: subhead left, first detail right.
          // The date takes its own width (at most half); the subhead has the rest — they never touch.
          const dateWidth = date ? Math.min(w * 0.5, measure(date, styleOf(T.label, scale.body)) + scale.body) : 0;
          if (C.subhead) text(ctx, C.subhead, { x, y, width: date ? w - dateWidth - u * 3 : w, size: scale.body, role: T.label, color: ink, maxLines: 1, align: date ? "left" : "right", name: "Subhead" });
          if (date) text(ctx, date, { x: x + w - dateWidth, y, width: dateWidth, size: scale.body, role: T.label, color: ink, maxLines: 1, align: "right", name: "Detail" });
        },
      },
    ],
    "top",
  );
  for (const node of ctx.nodes.slice(first)) node.shadow = shade;

  // ── Body copy beside the strip, right-aligned against it ───────────────────
  const sideWidth = win.x - m - u * 4;
  const rows = C.details.slice(1, 4).map((d) => d.text);
  const side: Blocks = [
    C.body && {
      priority: 40,
      gapBefore: 0,
      height: (w) => textHeight(C.body!, T.body, scale.body, w, 6),
      render: (x, y, w) => void text(ctx, C.body!, { x, y, width: w, size: scale.body, role: T.body, color: soft, maxLines: 6, align: "right", name: "Body" }),
    },
    rows.length > 0 && {
      priority: 55,
      gapBefore: u * 3,
      height: (w) => rows.reduce((sum, r) => sum + textHeight(r, T.label, scale.body, w, 2) + u, -u),
      render: (x, y, w) => {
        let cursor = y;
        for (const row of rows) cursor += text(ctx, row, { x, y: cursor, width: w, size: scale.body, role: T.label, color: ink, maxLines: 2, align: "right", name: "Detail" }).height + u;
      },
    },
  ];
  const sideTop = Math.max(win.y + win.height * 0.6, head.bottom + u * 5);
  if (!wide && win.y + win.height - sideTop > scale.body * 3) stack({ x: m, y: sideTop, width: sideWidth, height: win.y + win.height - sideTop }, side, "top");

  // ── Microtype along the strip's edge ──────────────────────────────────────
  const credit = C.brand ?? C.contact.website ?? C.contact.social[0] ?? null;
  if (credit) {
    const size = scale.caption;
    const placed = text(ctx, credit, { x: 0, y: 0, width: win.height * 0.5, size, role: T.label, color: ink, maxLines: 1, name: "Microtype" });
    placed.node.x = Math.round(win.x + win.width + u * 1.5 + size * T.label.leading);
    placed.node.y = Math.round(win.y + win.height * 0.45);
    placed.node.rotation = 90;
  }

  // ── Foot: handle and phone, the call to action ───────────────────────────
  const handle = C.contact.social.length ? socialLine(ctx) : null;
  const phone = C.contact.phone ?? contactLines(C).find((l) => l.icon !== "phone")?.text ?? null;
  const footY = H - m - scale.lead * 2.6;
  const x = m;
  if (handle) {
    icon(ctx, "at-sign", x, footY + scale.lead * 0.15, scale.lead, ink);
    text(ctx, handle, { x: x + scale.lead * 1.4, y: footY, width: W * 0.42, size: scale.lead, role: T.heading, color: ink, maxLines: 1, name: "Social" });
  }
  if (phone) text(ctx, phone, { x, y: footY + scale.lead * 1.35, width: W * 0.42, size: scale.body, role: T.label, color: ink, maxLines: 1, name: "Contact" });
  if (C.cta) ctaPill(ctx, C.cta, { x: W - m - u * 7, y: footY, color: ink, align: "right", outline: true, maxWidth: W * 0.36 });
}
