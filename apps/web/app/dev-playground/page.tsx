import { notFound } from "next/navigation";

import { FIXTURES } from "@/app/dev-playground/fixtures";
import type { GenerateResponse } from "@flyer/core/api/contracts";
import { ARCHETYPES } from "@flyer/core/design/archetypes";
import { composeDesign } from "@flyer/core/design/compose";
import { PALETTES } from "@flyer/core/design/palettes";
import { PAIRINGS } from "@flyer/core/design/typography";

import { PlaygroundLoader } from "./loader";

// TEMPORARY verification harness (no database/Stripe needed). Never served in production.
export default function PlaygroundPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const fixtures = FIXTURES.slice(0, 3);
  const result: GenerateResponse = {
    jobId: "job",
    projectId: "00000000-0000-4000-8000-000000000000",
    format: "poster",
    docs: fixtures.map((f) => composeDesign({ format: "poster", copy: f.copy, variant: f.variant, photos: f.photos })),
    directions: fixtures.map((f) => ({ layout: ARCHETYPES[f.variant.archetype].name, palette: PALETTES[f.variant.palette].name, type: PAIRINGS[f.variant.pairing].name })),
    rationale: "Trust blue signals competence; an editorial serif gives the headline authority, while the circular portrait and ring arc keep it human.",
    source: "rules",
    photoDownloads: fixtures.map(() => []),
    renderable: false,
    balance: 3,
  };
  return <PlaygroundLoader result={result} />;
}
