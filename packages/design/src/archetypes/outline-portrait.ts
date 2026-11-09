import { alpha, contrast, CONTRAST, mix } from "../color";
import { contactLines, hasPhoto, inkOn, photo, rect, styleOf, text, textHeight, type Ctx } from "../engine";
import { measure } from "../metrics";

/** The word to set huge in outline: the emphasis, else the headline's longest word. */
function outlineWord(headline: string, emphasis: string | null) {
  const candidate = emphasis && !/\s/.test(emphasis.trim()) ? emphasis.trim() : [...headline.split(/\s+/)].sort((a, b) => b.length - a.length)[0]!;
  return candidate.replace(/[^\p{L}\p{N}'’-]/gu, "").slice(0, 12) || headline.slice(0, 10);
}

/**
 * Outline portrait: a black-and-white portrait on textured paper, a giant outlined word
 * running up the left edge across it, one block of colour laid over the photo, and a thin
 * leader line from it to a tag carrying the message — an editorial, designer-made look.
 */
export function outlinePortrait(ctx: Ctx) {
  const { W, H, m, u, scale, palette: P, type: T, copy: C, orientation } = ctx;
  const wide = orientation === "landscape";
  // Paper: a light neutral, whatever the palette (the photo and the accent carry the colour).
  const paper = mix(P.surface, "#C9C9C9", contrast(P.surface, "#000000") > 10 ? 0.35 : 0.8);
  ctx.background = paper;
  rect(ctx, { x: 0, y: 0, width: W, height: H }, paper, { name: "Paper", locked: true });
  const textured = mix(paper, "#808080", 0.22); // what the eye sees through the grain
  const ink = inkOn(ctx, textured);
  const block = contrast(P.onPrimary, P.primary) >= CONTRAST.body ? P.primary : P.dark;
  const blockInk = inkOn(ctx, block);

  // ── The portrait, fading into the paper at its foot ───────────────────────
  const frame = wide ? { x: W * 0.3, y: 0, width: W * 0.5, height: H } : { x: W * 0.14, y: m * 0.5, width: W * 0.86 - m * 0.3, height: H * 0.86 };
  // Multiplied onto the paper: the photo's whites take the paper's tone, so no box shows — only the subject.
  if (hasPhoto(ctx, 0)) photo(ctx, 0, frame, { name: "Portrait", effects: { tone: "mono", grain: 0.2 } }).blend = "multiply";
  else rect(ctx, frame, mix(paper, "#000000", 0.18), { name: "Portrait slot" });
  // Feathered into the paper on every side, so the photo reads as part of the page, not a box on it.
  const clear = alpha(paper, 0);
  const fade = (box: { x: number; y: number; width: number; height: number }, from: string, to: string, horizontal = false) =>
    rect(ctx, box, "transparent", { gradient: { from, to, horizontal }, name: "Fade", locked: true });
  fade({ x: frame.x - 1, y: frame.y - 1, width: frame.width + 2, height: frame.height * 0.14 }, paper, clear);
  fade({ x: frame.x, y: frame.y + frame.height * 0.7, width: frame.width, height: frame.height * 0.3 + 2 }, clear, paper);
  fade({ x: frame.x - 1, y: frame.y, width: frame.width * 0.2, height: frame.height }, paper, clear, true);
  fade({ x: frame.x + frame.width * 0.84, y: frame.y, width: frame.width * 0.16 + 2, height: frame.height }, clear, paper, true);
  // The paper's tooth over everything below the type, so photo, fades and paper read as one surface.
  rect(ctx, { x: 0, y: 0, width: W, height: H }, "#808080", { texture: "grain", opacity: 0.22, blend: "multiply", name: "Paper texture", locked: true });

  // ── The outlined word, reading upwards along the left ─────────────────────
  const word = outlineWord(C.headline, C.emphasis).toUpperCase();
  const role = { ...T.display, uppercase: true, leading: 0.9 };
  const unit = measure(word, styleOf(role, 100)) / 100;
  const run = frame.height * 0.86;
  const size = Math.floor(Math.min(run / Math.max(unit, 0.3), (wide ? W * 0.14 : W * 0.24) / role.leading));
  const length = Math.min(run, measure(word, styleOf(role, size)) + size * 0.2);
  const outline = text(ctx, word, { x: 0, y: 0, width: length, size, role, color: ink, maxLines: 1, name: "Headline outline" });
  outline.node.rotation = -90;
  outline.node.x = Math.round(wide ? m : W * 0.06);
  outline.node.y = Math.round(frame.y + (frame.height + length) / 2);
  outline.node.fill = "transparent";
  outline.node.stroke = { color: ink, width: Math.max(2, Math.round(size * 0.012)) };

  // ── The colour block over the photo, a leader line, the tag ──────────────
  const blockBox = wide
    ? { x: frame.x + frame.width * 0.45, y: H * 0.22, width: frame.width * 0.4, height: H * 0.11 }
    : { x: frame.x + frame.width * 0.38, y: frame.y + frame.height * 0.2, width: frame.width * 0.3, height: frame.height * 0.08 };
  rect(ctx, blockBox, block, { blend: "multiply", name: "Accent block" });
  const tagWidth = wide ? W - m - (frame.x + frame.width * 0.88) : W * 0.46;
  const tagX = W - m * 0.6 - tagWidth;
  const tagY = wide ? H * 0.5 : frame.y + frame.height * 0.6;
  const line = Math.max(2, Math.round(u * 0.2));
  const elbowX = tagX + tagWidth * 0.82;
  rect(ctx, { x: blockBox.x + blockBox.width, y: blockBox.y + blockBox.height / 2 - line / 2, width: Math.max(line, elbowX - (blockBox.x + blockBox.width)), height: line }, block, { name: "Leader" });
  rect(ctx, { x: elbowX - line / 2, y: blockBox.y + blockBox.height / 2, width: line, height: tagY - (blockBox.y + blockBox.height / 2) }, block, { name: "Leader" });

  // One card on the block colour: headline, a rule, the brand and the signature.
  const pad = u * 1.8;
  const inner = tagWidth - 2 * pad;
  const headSize = Math.round(scale.h2 * (wide ? 0.95 : 1));
  const headHeight = textHeight(C.headline, T.display, headSize, inner, 2);
  const signature = C.subhead ?? C.eyebrow;
  const sigSize = Math.round(scale.lead * 1.1);
  const cardHeight =
    pad +
    headHeight +
    (C.brand || signature ? u * 2.4 + line : 0) +
    (C.brand ? scale.body * T.label.leading + u * 0.6 : 0) +
    (signature ? textHeight(signature, T.script, sigSize, inner, 1) : 0) +
    pad;
  rect(ctx, { x: tagX, y: tagY, width: tagWidth, height: cardHeight }, block, { name: "Tag" });
  let y = tagY + pad;
  y += text(ctx, C.headline, { x: tagX + pad, y, width: inner, size: headSize, role: T.display, color: blockInk, maxLines: 2, align: "center", name: "Headline" }).height;
  if (C.brand || signature) {
    rect(ctx, { x: tagX + pad * 2, y: y + u * 1.2, width: tagWidth - pad * 4, height: line }, blockInk, { name: "Rule" });
    y += u * 2.4 + line;
  }
  if (C.brand) y += text(ctx, C.brand, { x: tagX + pad, y, width: inner, size: scale.body, role: T.label, color: blockInk, maxLines: 1, align: "center", name: "Brand" }).height + u * 0.6;
  if (signature) text(ctx, signature, { x: tagX + pad, y, width: inner, size: sigSize, role: T.script, color: blockInk, maxLines: 1, align: "center", name: "Signature" });

  // ── Foot: details and contact, right-aligned under the tag ───────────────
  const lines = [...C.details.slice(0, 3).map((d) => d.text), C.cta, contactLines(C)[0]?.text].filter((l): l is string => Boolean(l));
  let footY = H - m * 0.7 - lines.length * scale.body * T.label.leading * 1.15;
  for (const value of lines) {
    text(ctx, value, { x: W * 0.4, y: footY, width: W * 0.6 - m * 0.6, size: scale.body, role: T.label, color: ink, maxLines: 1, align: "right", name: value === C.cta ? "CTA" : "Detail" });
    footY += scale.body * T.label.leading * 1.15;
  }
}
