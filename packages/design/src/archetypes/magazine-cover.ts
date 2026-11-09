import { ctaHeight, ctaPill, type Blocks } from "./shared";
import { alpha, mix } from "../color";
import { accentOn, contactLines, fitHeadline, hasPhoto, inkOn, photo, placeHeadline, rect, softOn, stack, styleOf, text, textHeight, type Ctx } from "../engine";
import { measure } from "../metrics";

/**
 * Magazine cover: a full-bleed photograph, the masthead (brand or eyebrow) set edge to
 * edge across the top, cover lines and the headline stacked at the foot over a scrim.
 * Fashion, beauty, music, profiles, launches.
 */
export function magazineCover(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const surface = P.dark;
  ctx.background = surface;
  const wide = orientation === "landscape";

  if (hasPhoto(ctx, 0)) {
    photo(ctx, 0, { x: 0, y: 0, width: W, height: H }, { name: "Cover photo" });
  } else {
    // No photograph: a deep tonal field so the cover still has depth.
    rect(ctx, { x: 0, y: 0, width: W, height: H }, "transparent", { gradient: { from: mix(surface, P.primary, 0.35), to: surface }, name: "Background", locked: true });
  }
  // Scrims where the type sits: the masthead band and the foot.
  rect(ctx, { x: 0, y: 0, width: W, height: H * 0.3 }, "transparent", { gradient: { from: alpha(surface, 0.78), to: alpha(surface, 0) }, name: "Scrim", locked: true });
  rect(ctx, { x: 0, y: H * 0.42, width: W, height: H * 0.58 }, "transparent", { gradient: { from: alpha(surface, 0), to: alpha(surface, 0.9) }, name: "Scrim", locked: true });

  const ink = inkOn(ctx, surface, true);
  const soft = softOn(ink, surface, 0.88);
  const accent = accentOn(ctx, surface, false);

  // ── Masthead: edge to edge, one line ─────────────────────────────────────
  const masthead = C.brand ?? C.eyebrow;
  const width = W - 2 * m;
  let top = m;
  if (masthead) {
    const role = { ...T.display, leading: 0.92 };
    const unit = measure(masthead, styleOf(role, 100)) / 100;
    const size = Math.floor(Math.min(width / Math.max(unit, 0.5), scale.hero * (wide ? 1.3 : 1.7)));
    text(ctx, masthead, { x: m, y: top, width, size, role, color: ink, maxLines: 1, align: wide ? "left" : "center", name: "Masthead" });
    top += size * role.leading + u * 1.5;
    // The issue line: the eyebrow (when the brand took the masthead) and the first detail.
    const issue = [C.brand ? C.eyebrow : null, C.details[0]?.text].filter(Boolean).join("   ·   ");
    if (issue) {
      rect(ctx, { x: m, y: top, width, height: Math.max(1, u * 0.2) }, ink, { name: "Rule" });
      text(ctx, issue, { x: m, y: top + u * 1.2, width, size: scale.caption, role: T.label, color: ink, maxLines: 1, align: wide ? "left" : "center", name: "Issue line" });
    }
  }

  // ── The foot: cover lines, headline, subhead, CTA ────────────────────────
  const column = wide ? W * 0.55 : width;
  const lines = (C.bullets.length ? C.bullets : C.details.slice(masthead ? 1 : 0).map((d) => d.text)).slice(0, 3);
  const footer = contactLines(C)[0]?.text ?? C.contact.social[0] ?? null;
  const footerHeight = footer ? scale.body * 1.6 : 0;
  const regionTop = H * (wide ? 0.38 : 0.5);
  const region = { x: m, y: regionTop, width: column, height: H - m - footerHeight - regionTop };
  const headline = fitHeadline(ctx, C.headline, C.emphasis, column, scale.hero * (wide ? 1 : 1.2), scale.h2, 3, 1, region.height * 0.55);
  const blocks: Blocks = [
    lines.length > 0 && {
      priority: 55,
      gapBefore: 0,
      height: (w) => lines.reduce((sum, l) => sum + textHeight(l, T.heading, scale.lead, w - u * 3, 1) + u, -u),
      render: (x, y, w) => {
        let cursor = y;
        for (const line of lines) {
          rect(ctx, { x, y: cursor + scale.lead * 0.2, width: Math.max(3, u * 0.6), height: scale.lead * 0.9 }, accent, { name: "Marker" });
          cursor += text(ctx, line, { x: x + u * 2.2, y: cursor, width: w - u * 3, size: scale.lead, role: T.heading, color: ink, maxLines: 1, name: "Cover line" }).height + u;
        }
      },
    },
    {
      priority: 100,
      gapBefore: u * 4,
      height: () => headline.lines.length * headline.size * T.display.leading,
      render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: "left", color: ink, emphasisColor: P.primary, background: surface }),
    },
    C.subhead && {
      priority: 70,
      gapBefore: u * 2,
      height: (w) => textHeight(C.subhead!, T.heading, scale.lead, w * 0.9, 2),
      render: (x, y, w) => void text(ctx, C.subhead!, { x, y, width: w * 0.9, size: scale.lead, role: T.heading, color: soft, maxLines: 2, name: "Subhead" }),
    },
    C.cta && {
      priority: 45,
      gapBefore: u * 4,
      height: () => ctaHeight(ctx),
      render: (x, y, w) => void ctaPill(ctx, C.cta!, { x, y, color: accentOn(ctx, surface, true), maxWidth: w }),
    },
  ];
  stack(region, blocks, "bottom");
  if (footer) text(ctx, footer, { x: m, y: H - m - scale.body * 1.3, width, size: scale.body, role: T.label, color: ink, maxLines: 1, name: "Footer" });
}
