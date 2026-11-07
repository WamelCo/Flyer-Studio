import type { FlyerDoc, TextNode } from "@/lib/canvas/types";
import { inkBounds, inkLines, overlapRatio, type Box } from "@/lib/design/geometry";

/**
 * Objective design checks — instant, free, deterministic. They catch what is plainly
 * broken (cut-off or colliding type, unreadably small text, empty frames) before the
 * vision critic judges what is merely weak. Used in the pipeline and the benchmark.
 */

export type LintCode = "text_off_page" | "text_overlap" | "tiny_text" | "edge_crowding" | "empty_frame" | "weak_hierarchy";

export interface LintIssue {
  code: LintCode;
  severity: "error" | "warning";
  message: string;
}

export interface LintResult {
  issues: LintIssue[];
  errors: number;
  warnings: number;
  /** 100 = clean; −25 per error, −5 per warning. */
  score: number;
}

const short = (node: TextNode) => `“${node.text.replace(/\s+/g, " ").slice(0, 28)}”`;

/**
 * A script word tucked into the top of the headline is a deliberate lettering lockup
 * (photo-overlay), as long as it only overlaps the headline's top edge.
 */
function scriptLockup(a: TextNode, b: TextNode, ratio: number) {
  const pair = [a.name, b.name];
  return pair.includes("Script") && (pair.includes("Headline") || pair.includes("Headline emphasis")) && ratio < 0.5;
}

/** Text runs of one headline line sit edge to edge on purpose; they are not collisions. */
function sameHeadlineLine(a: TextNode, b: TextNode, boxA: Box, boxB: Box) {
  const headline = (n: TextNode) => n.name === "Headline" || n.name === "Headline emphasis";
  if (!headline(a) || !headline(b)) return false;
  const centreA = boxA.y + boxA.height / 2;
  const centreB = boxB.y + boxB.height / 2;
  return Math.abs(centreA - centreB) < Math.max(boxA.height, boxB.height) * 0.5;
}

export function lintDoc(doc: FlyerDoc): LintResult {
  const issues: LintIssue[] = [];
  const short_side = Math.min(doc.width, doc.height);
  const texts = doc.nodes.filter((n): n is TextNode => n.type === "text" && !n.hidden && n.opacity > 0 && n.text.trim().length > 0);
  const boxes = texts.map(inkBounds);

  // Off the page: anything past a 1% tolerance gets trimmed by the printer.
  const tolerance = short_side * 0.01;
  texts.forEach((node, i) => {
    const b = boxes[i]!;
    if (b.x < -tolerance || b.y < -tolerance || b.x + b.width > doc.width + tolerance || b.y + b.height > doc.height + tolerance) {
      issues.push({ code: "text_off_page", severity: "error", message: `${short(node)} runs off the page` });
    } else {
      const margin = short_side * 0.025;
      if (b.x < margin || b.y < margin || b.x + b.width > doc.width - margin || b.y + b.height > doc.height - margin) {
        issues.push({ code: "edge_crowding", severity: "warning", message: `${short(node)} sits closer than 2.5% to the edge` });
      }
    }
  });

  // Colliding text, compared line by line (a block's widest line mustn't speak for the others).
  const lines = texts.map(inkLines);
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const ratio = Math.max(0, ...lines[i]!.flatMap((a) => lines[j]!.map((b) => overlapRatio(a, b))));
      if (ratio > 0.12 && !sameHeadlineLine(texts[i]!, texts[j]!, boxes[i]!, boxes[j]!) && !scriptLockup(texts[i]!, texts[j]!, ratio)) {
        issues.push({ code: "text_overlap", severity: "error", message: `${short(texts[i]!)} overlaps ${short(texts[j]!)}` });
      }
    }
  }

  // Too small to read in print: ~7 pt on an A4 page.
  const minimum = short_side * 0.0095;
  for (const node of texts) {
    if (node.fontSize < minimum) issues.push({ code: "tiny_text", severity: "warning", message: `${short(node)} is ${node.fontSize}px (min ${Math.ceil(minimum)})` });
  }

  // An empty photo slot reads as unfinished.
  const empty = doc.nodes.filter((n) => n.type === "image" && !n.src && !n.hidden).length;
  if (empty) issues.push({ code: "empty_frame", severity: "warning", message: `${empty} empty photo frame${empty > 1 ? "s" : ""}` });

  // The headline should be the biggest type on the page.
  const largest = texts.reduce<TextNode | null>((a, b) => (!a || b.fontSize > a.fontSize ? b : a), null);
  if (largest && !/^Headline|^Badge|^Script/.test(largest.name) && texts.some((t) => t.name.startsWith("Headline"))) {
    issues.push({ code: "weak_hierarchy", severity: "warning", message: `${short(largest)} is larger than the headline` });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return { issues, errors, warnings, score: Math.max(0, 100 - errors * 25 - warnings * 5) };
}
