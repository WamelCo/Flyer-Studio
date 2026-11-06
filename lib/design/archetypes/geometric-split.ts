import { joinDetails } from "@/lib/design/archetypes/shared";
import { alpha, isDark } from "@/lib/design/color";
import {
  circle,
  contactLines,
  fitHeadline,
  hasPhoto,
  icon,
  iconRows,
  iconRowsHeight,
  inkOn,
  mutedOn,
  photo,
  placeHeadline,
  rect,
  softOn,
  stack,
  text,
  textHeight,
  type Block,
  type Ctx,
} from "@/lib/design/engine";

/**
 * Geometric split (brochure reference): light and dark fields meet at a seam where
 * overlapping circles — photo-filled or tinted — form a Venn-like focal point.
 * Section copy sits on the light side, the headline and contact on the dark side.
 */
export function geometricSplit(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  // The split needs real contrast: on dark palettes the light field becomes the palette's light ink.
  const light = isDark(P.bg) ? P.ink : P.bg;
  const dark = isDark(P.dark) ? P.dark : P.ink;
  ctx.background = light;
  const wide = orientation === "landscape";
  const seam = Math.round(W * (wide ? 0.5 : 0.42));

  rect(ctx, { x: seam, y: 0, width: W - seam, height: H }, dark, { name: "Dark field", locked: true });

  const onLight = inkOn(ctx, light);
  const mutedLight = mutedOn(ctx, light);
  const onDark = inkOn(ctx, dark);
  const mutedDark = softOn(onDark, dark, 0.78);

  // ── Circle cluster on the seam ─────────────────────────────────────────
  const square = orientation === "square";
  const R = Math.round(Math.min(W, H) * (wide ? 0.19 : square ? 0.155 : 0.21));
  const cy = H * (wide ? 0.5 : square ? 0.53 : 0.47);
  const centres = [
    { x: seam, y: cy - R * 0.62 },
    { x: seam - R * 0.72, y: cy + R * 0.1 },
    { x: seam + R * 0.72, y: cy + R * 0.1 },
    { x: seam, y: cy + R * 0.78 },
  ];
  const tints = [P.accent, P.accent2, P.primary, P.tint];
  centres.forEach((c, i) => {
    const frame = { x: c.x - R, y: c.y - R, width: R * 2, height: R * 2 };
    if (hasPhoto(ctx, i % Math.max(1, ctx.photos.length)) && ctx.photos.length) {
      photo(ctx, i % ctx.photos.length, frame, { cornerRadius: R, name: "Circle photo" });
      circle(ctx, c.x, c.y, R, tints[i]!, { opacity: 0.32, name: "Tint" });
    } else {
      circle(ctx, c.x, c.y, R, tints[i]!, { opacity: 0.72, name: "Colour circle" });
    }
  });
  centres.forEach((c) => circle(ctx, c.x, c.y, R, "transparent", { stroke: { color: alpha("#FFFFFF", 0.9), width: Math.max(2, u * 0.35) }, name: "Outline" }));

  // ── Dark side: brand, headline, contact ────────────────────────────────
  // In landscape the circles reach far into the dark field, so its copy starts past them.
  const darkTextX = wide ? seam + R * 1.75 + u * 3 : seam + m * 0.8;
  const darkWidth = W - m - darkTextX;
  if (C.brand) {
    const size = scale.lead;
    circle(ctx, W - m - size * 0.8, m + size * 0.8, size * 0.8, onDark, { name: "Brand mark" });
    icon(ctx, C.features[0]?.icon ?? "sparkles", W - m - size * 1.25, m + size * 0.35, size * 0.9, dark);
    text(ctx, C.brand, { x: darkTextX, y: m + size * 0.25, width: darkWidth - size * 2.2, size, role: T.heading, color: onDark, maxLines: 1, align: "right", name: "Brand" });
  }

  const headTop = m + scale.lead * 3;
  const headBottom = wide ? H * 0.62 : centres[0]!.y - R - u * 3;
  const headWidth = W - m - darkTextX;
  const subheadSpace = C.subhead ? scale.body * 3 : 0;
  const headline = fitHeadline(ctx, C.headline, C.emphasis, headWidth, scale.h1, scale.h3, 4, 1, Math.max(scale.h3 * 1.2, headBottom - headTop - subheadSpace));
  stack(
    { x: darkTextX, y: headTop, width: headWidth, height: Math.max(headline.size * 2, (wide ? H * 0.62 : headBottom) - headTop) },
    [
      {
        priority: 100,
        gapBefore: 0,
        height: () => headline.lines.length * headline.size * T.display.leading,
        render: (x, y, width) => placeHeadline(ctx, headline, { x, y, width, align: "left", color: onDark, emphasisColor: P.accent, background: dark }),
      },
      Boolean(C.subhead) && {
        priority: 60,
        gapBefore: u * 2,
        height: (width) => textHeight(C.subhead!, T.heading, scale.body, width, 2),
        render: (x, y, width) => void text(ctx, C.subhead!, { x, y, width, size: scale.body, role: T.heading, color: mutedDark, maxLines: 2, name: "Subhead" }),
      },
    ],
    "bottom",
  );

  const contact = contactLines(C);
  const lowerTop = centres[3]!.y + R + u * 4;
  if (contact.length) {
    const rowsHeight = iconRowsHeight(ctx, contact, darkWidth, scale.caption);
    iconRows(ctx, contact, darkTextX, wide ? H - m - rowsHeight : Math.max(lowerTop, H - m - rowsHeight), W - m - darkTextX, scale.caption, onDark, P.accent);
  } else if (C.cta) {
    text(ctx, C.cta, { x: seam + m * 0.8, y: H - m - scale.lead * 1.3, width: W - m - (seam + m * 0.8), size: scale.lead, role: T.label, color: P.accent, maxLines: 1, name: "CTA" });
  }

  // ── Light side: section title + body (top), details band (bottom) ──────
  const lightWidth = seam - R * 0.95 - m - u * 2;
  const bodySize = lightWidth > W * 0.25 ? scale.body : scale.caption;
  const sectionTitle = C.bodyTitle ?? C.eyebrow;
  const topBlocks: Block[] = [];
  if (sectionTitle) {
    topBlocks.push({
      priority: 80,
      gapBefore: 0,
      height: (width) => textHeight(sectionTitle, T.label, scale.body, width, 2),
      render: (x, y, width) => void text(ctx, sectionTitle, { x, y, width, size: scale.body, role: T.label, color: onLight, maxLines: 2, name: "Section title" }),
    });
  }
  if (C.body) {
    topBlocks.push({
      priority: 70,
      gapBefore: u * 2,
      height: (width) => textHeight(C.body!, T.body, bodySize, width, 7),
      render: (x, y, width) => void text(ctx, C.body!, { x, y, width, size: bodySize, role: T.body, color: mutedLight, maxLines: 7, name: "Body" }),
    });
  }
  stack({ x: m, y: m + scale.lead * 3, width: Math.max(W * 0.2, lightWidth), height: centres[1]!.y - R * 0.4 - (m + scale.lead * 3) }, topBlocks, "top");

  // A dark band anchors the light side's foot, echoing the dark field.
  const bandTop = Math.max(lowerTop - u * 2, H * 0.7);
  const bandHeight = H - m * 1.6 - bandTop;
  const bandText = C.bullets.length ? C.bullets.slice(0, 4).join("  ·  ") : C.details.length ? joinDetails(ctx) : null;
  if (bandText && bandHeight > scale.body * 4) {
    rect(ctx, { x: 0, y: bandTop, width: seam - R * 0.5, height: bandHeight }, dark, { name: "Band" });
    const bandWidth = seam - R * 0.5 - m - u * 3;
    stack(
      { x: m, y: bandTop + u * 3, width: bandWidth, height: bandHeight - u * 6 },
      [
        Boolean(C.subhead && C.bodyTitle) && {
          priority: 50,
          gapBefore: 0,
          height: (width) => textHeight(C.subhead!, T.label, scale.caption, width, 2),
          render: (x, y, width) => void text(ctx, C.subhead!, { x, y, width, size: scale.caption, role: T.label, color: onDark, maxLines: 2 }),
        },
        {
          priority: 60,
          gapBefore: u * 1.5,
          height: (width) => textHeight(bandText, T.body, scale.caption, width, 5),
          render: (x, y, width) => void text(ctx, bandText, { x, y, width, size: scale.caption, role: T.body, color: mutedDark, maxLines: 5, name: "Band text" }),
        },
      ],
      "center",
    );
  }
}
