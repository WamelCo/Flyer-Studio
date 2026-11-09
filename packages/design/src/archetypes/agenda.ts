import { ctaHeight, ctaPill, splitTime, type Blocks } from "./shared";
import { accentOn, circle, contactLines, fitHeadline, inkOn, mutedOn, placeHeadline, rect, stack, text, textHeight, type Ctx, type DesignCopy } from "../engine";

interface Step {
  time: string | null;
  label: string;
  note: string | null;
}

/** The programme: features (title + text) or bullets ("9:00 Registration"), times as written. */
export function agendaSteps(copy: DesignCopy): Step[] {
  const features = copy.features.map((f) => {
    const split = splitTime(f.title);
    return { time: split.time, label: split.label, note: f.text || null };
  });
  const bullets = copy.bullets.map((b) => ({ ...splitTime(b), note: null }));
  // The list that carries times is the programme.
  const timed = (list: Step[]) => list.filter((step) => step.time).length;
  if (timed(bullets) > timed(features)) return bullets;
  return features.length >= 2 ? features : bullets;
}

/**
 * Agenda: a programme as a vertical timeline — a rail with a node per step, times in the
 * accent, each step's title and note beside it. Header above (or to the left on a wide
 * page), details and the call to action at the foot. Conferences, workshops, itineraries.
 */
export function agenda(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  ctx.background = P.bg;
  const ink = inkOn(ctx, P.bg);
  const muted = mutedOn(ctx, P.bg);
  const accent = accentOn(ctx, P.bg, false);
  const wide = orientation === "landscape";
  const steps = agendaSteps(C).slice(0, 7);

  // A colour block anchors the header.
  const header = wide ? { x: m, y: m, width: W * 0.36 - m, height: H - 2 * m } : { x: m, y: m, width: W - 2 * m, height: H * (orientation === "tall" ? 0.27 : 0.3) - m };
  rect(ctx, wide ? { x: 0, y: 0, width: W * 0.36 + m * 0.4, height: H } : { x: 0, y: 0, width: W, height: header.y + header.height + m * 0.6 }, P.dark, { name: "Header field", locked: true });
  const headerInk = inkOn(ctx, P.dark);
  const headerAccent = accentOn(ctx, P.dark, false);
  const headline = fitHeadline(ctx, C.headline, C.emphasis, header.width, scale.hero * (wide ? 0.75 : 0.9), scale.h2, 3, 1, header.height * 0.6);
  const contact = contactLines(C)
    .slice(0, 2)
    .map((l) => l.text);
  stack(
    header,
    [
      C.eyebrow && {
        priority: 60,
        gapBefore: 0,
        height: () => scale.body * T.label.leading,
        render: (x, y, w) => void text(ctx, C.eyebrow!, { x, y, width: w, size: scale.body, role: T.label, color: headerAccent, maxLines: 1, name: "Eyebrow" }),
      },
      {
        priority: 100,
        gapBefore: u * 2,
        height: () => headline.lines.length * headline.size * T.display.leading,
        render: (x, y, w) => placeHeadline(ctx, headline, { x, y, width: w, align: "left", color: headerInk, emphasisColor: P.primary, background: P.dark }),
      },
      C.subhead && {
        priority: 70,
        gapBefore: u * 2.5,
        height: (w) => textHeight(C.subhead!, T.heading, scale.lead, w, 2),
        render: (x, y, w) => void text(ctx, C.subhead!, { x, y, width: w, size: scale.lead, role: T.heading, color: headerInk, maxLines: 2, name: "Subhead" }),
      },
      wide &&
        C.details.length > 0 && {
          priority: 55,
          gapBefore: u * 5,
          height: (w) => C.details.slice(0, 3).reduce((sum, d) => sum + textHeight(d.text, T.label, scale.body, w, 2) + u, -u),
          render: (x, y, w) => {
            let cursor = y;
            for (const d of C.details.slice(0, 3)) cursor += text(ctx, d.text, { x, y: cursor, width: w, size: scale.body, role: T.label, color: headerInk, maxLines: 2, name: "Detail" }).height + u;
          },
        },
      wide &&
        C.cta && {
          priority: 45,
          gapBefore: u * 5,
          height: () => ctaHeight(ctx),
          render: (x, y, w) => void ctaPill(ctx, C.cta!, { x, y, color: P.primary, maxWidth: w }),
        },
    ],
    wide ? "center" : "bottom",
  );

  // ── Foot (portrait): details line + CTA + contact ─────────────────────────
  let bottom = H - m;
  if (!wide) {
    const foot: Blocks = [
      C.details.length > 0 && {
        priority: 60,
        gapBefore: 0,
        height: (w) => textHeight(C.details.map((d) => d.text).join("  ·  "), T.label, scale.body, w * 0.62, 2),
        render: (x, y, w) => void text(ctx, C.details.map((d) => d.text).join("  ·  "), { x, y, width: w * 0.62, size: scale.body, role: T.label, color: ink, maxLines: 2, name: "Details" }),
      },
      contact.length > 0 && {
        priority: 40,
        gapBefore: u * 1.5,
        height: () => scale.caption * T.label.leading,
        render: (x, y, w) => void text(ctx, contact.join("   ·   "), { x, y, width: w * 0.62, size: scale.caption, role: T.label, color: muted, maxLines: 1, name: "Contact" }),
      },
    ];
    const footHeight = Math.max(C.cta ? ctaHeight(ctx) : 0, C.details.length || contact.length ? scale.body * 4 : 0);
    if (footHeight) {
      stack({ x: m, y: H - m - footHeight, width: W - 2 * m, height: footHeight }, foot, "bottom");
      if (C.cta) ctaPill(ctx, C.cta, { x: W - m, y: H - m - ctaHeight(ctx), color: P.primary, align: "right", maxWidth: (W - 2 * m) * 0.36 });
      bottom = H - m - footHeight - u * 5;
    }
  }

  // ── Timeline ──────────────────────────────────────────────────────────────
  const area = wide ? { x: W * 0.36 + m * 1.4, y: m, width: W - m - (W * 0.36 + m * 1.4), height: H - 2 * m } : { x: m, y: header.y + header.height + m * 0.6 + u * 6, width: W - 2 * m, height: 0 };
  if (!wide) area.height = bottom - area.y;
  const node = Math.round(scale.body * 0.45);
  const timeWidth = steps.some((s) => s.time) ? Math.min(area.width * 0.24, scale.lead * 5.5) : 0;
  const railX = area.x + timeWidth + (timeWidth ? u * 3 : 0) + node;
  const textX = railX + node + u * 3;
  const textWidth = area.x + area.width - textX;
  const stepHeight = (s: Step) => textHeight(s.label, T.heading, scale.lead, textWidth, 2) + (s.note ? u * 0.6 + textHeight(s.note, T.body, scale.body, textWidth, 2) : 0);
  let fit = steps;
  const total = (list: Step[], gap: number) => list.reduce((sum, s) => sum + stepHeight(s), 0) + Math.max(0, list.length - 1) * gap;
  while (fit.length > 1 && total(fit, u * 4) > area.height) fit = fit.slice(0, -1);
  const gap = fit.length > 1 ? Math.min(u * 9, Math.max(u * 4, (area.height - total(fit, 0)) / (fit.length - 1))) : 0;
  const used = total(fit, gap);
  let y = area.y + (area.height - used) / 2;
  const first = y;
  let lastNode = y;
  const rail = ctx.nodes.length;
  for (const step of fit) {
    const ny = y + scale.lead * T.heading.leading * 0.5;
    circle(ctx, railX, ny, node, P.primary, { name: "Node" });
    lastNode = ny;
    if (step.time) text(ctx, step.time, { x: area.x, y, width: timeWidth, size: scale.lead, role: T.heading, color: accent, maxLines: 1, align: "right", name: "Time" });
    const placed = text(ctx, step.label, { x: textX, y, width: textWidth, size: scale.lead, role: T.heading, color: ink, maxLines: 2, name: "Step" });
    if (step.note) text(ctx, step.note, { x: textX, y: y + placed.height + u * 0.6, width: textWidth, size: scale.body, role: T.body, color: muted, maxLines: 2, name: "Step note" });
    y += stepHeight(step) + gap;
  }
  // The rail runs node to node, behind them.
  if (fit.length > 1) {
    const line = rect(ctx, { x: railX - Math.max(1, u * 0.18), y: first + scale.lead * T.heading.leading * 0.5, width: Math.max(2, u * 0.36), height: lastNode - (first + scale.lead * T.heading.leading * 0.5) }, accent, { name: "Rail" });
    ctx.nodes.splice(ctx.nodes.indexOf(line), 1);
    ctx.nodes.splice(rail, 0, line);
  }
}
