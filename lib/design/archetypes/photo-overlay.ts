import { joinDetails } from "@/lib/design/archetypes/shared";
import { alpha, mix } from "@/lib/design/color";
import {
  circle,
  fitHeadline,
  hasPhoto,
  inkOn,
  photo,
  placeHeadline,
  rect,
  ring,
  softOn,
  stack,
  text,
  textHeight,
  type Block,
  type Ctx,
} from "@/lib/design/engine";

/**
 * Photo overlay (Thanksgiving reference): full-bleed photograph under a dark scrim, with
 * a centred stack — brand caps, a script word layered over tall condensed capitals,
 * a hairline divider, a script subline, body, and the web address at the foot.
 */
export function photoOverlay(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const surface = P.dark;
  const lifted = mix(surface, P.primary, 0.22);
  ctx.background = surface;
  const photographed = hasPhoto(ctx, 0);

  if (photographed) {
    photo(ctx, 0, { x: 0, y: 0, width: W, height: H }, { name: "Background photo" });
    // Scrim: darker towards the type so every word clears contrast on any photo.
    rect(ctx, { x: 0, y: 0, width: W, height: H }, "transparent", {
      gradient: { from: alpha(surface, 0.45), to: alpha(surface, 0.72) },
      name: "Scrim",
      locked: true,
    });
  } else {
    // No photograph: a quiet tonal field of rings so the type still has depth.
    // Always a dark field (white type), lifted towards the primary at the top.
    rect(ctx, { x: 0, y: 0, width: W, height: H }, "transparent", { gradient: { from: lifted, to: surface }, name: "Background", locked: true });
    ring(ctx, W * 0.5, H * 0.46, Math.min(W, H) * 0.46, u * 0.35, P.primary, 0, 360, 0.35);
    ring(ctx, W * 0.5, H * 0.46, Math.min(W, H) * 0.38, u * 0.2, P.primary, 0, 360, 0.2);
    circle(ctx, W * 0.5, H * 0.46, Math.min(W, H) * 0.3, P.primary, { opacity: 0.08, name: "Glow" });
  }

  const ink = inkOn(ctx, surface, true);
  const soft = softOn(ink, surface, 0.86);
  const width = W - 2 * m * (orientation === "landscape" ? 2.6 : 1.4);
  const x = (W - width) / 2;

  if (C.brand) {
    text(ctx, C.brand, { x, y: m * 1.2, width, size: scale.body, role: T.label, color: ink, maxLines: 1, align: "center", name: "Brand" });
  }

  const headline = fitHeadline(ctx, C.headline, C.emphasis, width, scale.hero * 1.15, scale.h2, orientation === "landscape" ? 2 : 3);
  const scriptSize = Math.round(Math.max(scale.h1 * 0.85, headline.size * 0.7));
  const blocks: Block[] = [];

  if (C.eyebrow) {
    blocks.push({
      priority: 70,
      gapBefore: 0,
      // The script word tucks into the top of the headline, as hand lettering would.
      height: () => scriptSize * 0.9,
      render: (bx, by, bw) => void text(ctx, C.eyebrow!, { x: bx, y: by, width: bw, size: scriptSize, role: T.script, color: ink, maxLines: 1, align: "center", name: "Script" }),
    });
  }
  blocks.push({
    priority: 100,
    gapBefore: 0,
    height: () => headline.lines.length * headline.size * T.display.leading,
    render: (bx, by, bw) => placeHeadline(ctx, headline, { x: bx, y: by, width: bw, align: "center", color: ink, emphasisColor: P.primary, background: photographed ? surface : [lifted, surface] }),
  });
  blocks.push({
    priority: 40,
    gapBefore: u * 4,
    height: () => u * 0.4,
    render: (bx, by, bw) => void rect(ctx, { x: bx + bw / 2 - W * 0.07, y: by, width: W * 0.14, height: Math.max(2, u * 0.35) }, P.primary, { name: "Divider" }),
  });
  if (C.subhead) {
    const size = Math.round(scale.h2 * 0.95);
    blocks.push({
      priority: 60,
      gapBefore: u * 3,
      height: (bw) => textHeight(C.subhead!, T.script, size, bw, 1),
      render: (bx, by, bw) => void text(ctx, C.subhead!, { x: bx, y: by, width: bw, size, role: T.script, color: ink, maxLines: 1, align: "center", name: "Subhead" }),
    });
  }
  if (C.body) {
    blocks.push({
      priority: 45,
      gapBefore: u * 2,
      height: (bw) => textHeight(C.body!, T.body, scale.lead, bw * 0.8, 3),
      render: (bx, by, bw) => void text(ctx, C.body!, { x: bx + bw * 0.1, y: by, width: bw * 0.8, size: scale.lead, role: T.body, color: soft, maxLines: 3, align: "center", name: "Body" }),
    });
  }
  if (C.details.length) {
    const line = joinDetails(ctx);
    blocks.push({
      priority: 50,
      gapBefore: u * 3,
      height: (bw) => textHeight(line, T.label, scale.body, bw, 2),
      render: (bx, by, bw) => void text(ctx, line, { x: bx, y: by, width: bw, size: scale.body, role: T.label, color: ink, maxLines: 2, align: "center", name: "Details" }),
    });
  }
  if (C.cta) {
    blocks.push({
      priority: 30,
      gapBefore: u * 4,
      height: () => scale.body * 2.6,
      render: (bx, by, bw) => {
        const w = Math.min(bw * 0.6, W * 0.42);
        rect(ctx, { x: bx + (bw - w) / 2, y: by, width: w, height: scale.body * 2.6 }, "transparent", { stroke: { color: ink, width: Math.max(2, u * 0.25) }, cornerRadius: scale.body * 1.3, name: "CTA" });
        text(ctx, C.cta!, { x: bx + (bw - w) / 2 + scale.body, y: by + scale.body * 0.8, width: w - scale.body * 2, size: scale.body, role: T.label, color: ink, maxLines: 1, align: "center" });
      },
    });
  }

  const footer = C.contact.website ?? C.contact.phone ?? C.contact.social[0] ?? null;
  const footerHeight = footer ? scale.lead * 1.6 : 0;
  const top = C.brand ? m * 1.2 + scale.body * 3 : m;
  stack({ x, y: top, width, height: H - m - footerHeight - top }, blocks, "center");

  if (footer) {
    text(ctx, footer, { x, y: H - m - scale.lead * 1.2, width, size: scale.lead, role: T.body, color: ink, maxLines: 1, align: "center", name: "Footer" });
  }
}
