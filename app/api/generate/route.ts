import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { MAX_PROMPT_LENGTH, sanitizePrompt } from "@/lib/ai/prompt";
import type { GenerateAccepted } from "@/lib/api/contracts";
import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { deductCredits } from "@/lib/db/credits";
import { createJob, jobsReady, runJob } from "@/lib/generation/jobs";
import { enforce, LIMITS } from "@/lib/rate-limit";
import { CREDIT_COSTS } from "@/lib/stripe/plans";

export const runtime = "nodejs";
// The job runs after the response (after()); this bounds the whole lifetime, including
// Ideogram generate + Layerize (~30–60 s) on top of art direction.
export const maxDuration = 120;

const Body = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH * 2),
  format: z.enum(["poster", "square", "story", "landscape"]),
});

/**
 * Starts a generation: rate-limits, charges credits atomically, creates the job and
 * returns 202 with its id at once. The work continues in the background (see
 * lib/generation/jobs.ts); the client polls GET /api/generate/[jobId].
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const body = await parseJson(request, Body);

  const prompt = sanitizePrompt(body.prompt);
  if (prompt.length < 3) throw new ApiException("VALIDATION_ERROR", "Describe your flyer in a few words.");

  await enforce(LIMITS.generate(user.id), "You're generating very quickly. Give it a minute and try again.");

  const jobId = randomUUID();
  const cost = CREDIT_COSTS.generate;

  // Credit check + deduction happen atomically in Postgres before any paid work starts.
  const charge = await deductCredits({ userId: user.id, amount: cost, reason: "generate", idempotencyKey: `generate:${user.id}:${jobId}` });
  if (!charge.ok) {
    throw new ApiException("INSUFFICIENT_CREDITS", `Generating needs ${cost} credits. You have ${charge.balance}.`, {
      required: cost,
      balance: charge.balance,
    });
  }

  const input = { jobId, userId: user.id, prompt, format: body.format, cost, balance: charge.balance };

  if (await jobsReady()) {
    await createJob(input);
    after(() => runJob(input, "background"));
    const accepted: GenerateAccepted = { jobId, status: "pending", balance: charge.balance };
    return NextResponse.json(accepted, { status: 202 });
  }

  // Phase 0 migration not applied yet: run inside the request, as before.
  const outcome = await runJob(input, "inline");
  if (!outcome.ok) throw new ApiException(outcome.code, outcome.message, { balance: outcome.balance });
  return NextResponse.json(outcome.response);
});
