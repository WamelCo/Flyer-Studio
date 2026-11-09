import { notFound } from "next/navigation";

import { FIXTURES } from "@/app/dev-playground/fixtures";
import type { GenerateResponse } from "@/lib/api/contracts";
import { ARCHETYPE_IDS, ARCHETYPES, type ArchetypeId } from "@flyer/design/archetypes";
import { composeDesign } from "@flyer/design/compose";
import { PALETTES } from "@flyer/design/palettes";
import { PAIRINGS } from "@flyer/design/typography";

import { PlaygroundLoader } from "./loader";

// TEMPORARY verification harness (no database or payments needed). Never served in production.
// ?layout=<archetype id> opens the first fixture in that layout (e.g. ?mode=editor&layout=focus-window).
export default async function PlaygroundPage({ searchParams }: PageProps<"/dev-playground">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { layout } = await searchParams;
  const chosen = typeof layout === "string" && (ARCHETYPE_IDS as readonly string[]).includes(layout) ? (layout as ArchetypeId) : null;
  const fixtures = FIXTURES.slice(0, 3).map((f, i) => (chosen && i === 0 ? { ...f, variant: { ...f.variant, archetype: chosen } } : f));
  const result: GenerateResponse = {
    jobId: "job",
    projectId: "00000000-0000-4000-8000-000000000000",
    format: "poster",
    docs: fixtures.map((f) => composeDesign({ format: "poster", copy: f.copy, variant: f.variant, photos: f.photos })),
    directions: fixtures.map((f) => ({ layout: ARCHETYPES[f.variant.archetype].name, palette: PALETTES[f.variant.palette].name, type: PAIRINGS[f.variant.pairing].name })),
    rationale: "Trust blue signals competence; an editorial serif gives the headline authority, while the circular portrait and ring arc keep it human.",
    source: "rules",
    photoDownloads: fixtures.map(() => []),
    balance: 3,
  };
  return <PlaygroundLoader result={result} />;
}
