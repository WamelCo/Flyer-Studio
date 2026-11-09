import { addCredits, aiGenerationLogs, db, eq, generationJobs, returnFreeFlyer } from "@flyer/db";
import { log } from "@flyer/log";

import { DirectorRefusal } from "./director";
import { designFlyer, type DesignResult, type GenerationInput, type Stage } from "./pipeline";

/**
 * Generation jobs. The caller charges credits and creates a `pending` row (createJob), then
 * runs the job after responding (runJob) — Next.js `after()` on the web, the bot's own
 * process on WhatsApp. Every step writes a heartbeat; the scheduled sweep fails and refunds
 * any job silent for 5 minutes (same refund key, so never twice).
 */

export type FailureCode = "GENERATION_BLOCKED" | "GENERATION_FAILED";

export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  GENERATION_BLOCKED: "Could not generate design. Please try a different prompt.",
  GENERATION_FAILED: "We couldn't design this flyer. Your credits were returned — please try again.",
};

export type RunOutcome = { ok: true; response: DesignResult } | { ok: false; code: FailureCode; message: string; balance: number | null };

export async function createJob(input: GenerationInput) {
  await db()
    .insert(generationJobs)
    .values({
      id: input.jobId,
      userId: input.userId,
      prompt: input.prompt,
      intent: "event", // refined from the brief when the job finishes
      format: input.format,
      channel: input.channel ?? "web",
      status: "pending",
      stage: "queued",
      creditsSpent: input.cost,
      freeFlyer: input.freeFlyer ?? false,
      heartbeatAt: new Date(),
    });
}

/** Runs one generation to completion; progress and the outcome are written to the job row. */
export async function runJob(
  input: GenerationInput & { balance: number },
  { report }: { report?: (error: unknown, extra: Record<string, unknown>) => void } = {},
): Promise<RunOutcome> {
  const started = Date.now();
  const update = async (fields: Partial<typeof generationJobs.$inferInsert>) => {
    try {
      await db().update(generationJobs).set(fields).where(eq(generationJobs.id, input.jobId));
    } catch (error) {
      log.warn("jobs.update_failed", { jobId: input.jobId, reason: error instanceof Error ? error.message : String(error) });
    }
  };
  const onStage = async (stage: Stage) => {
    await update({ stage, heartbeatAt: new Date() });
    log.debug("generation.stage", { jobId: input.jobId, stage, ms: Date.now() - started });
  };

  await update({ status: "running", startedAt: new Date() });
  log.info("generation.started", { jobId: input.jobId, userId: input.userId, format: input.format, channel: input.channel ?? "web" });

  try {
    const { response, record } = await designFlyer(input, onStage);
    await update({
      status: "succeeded",
      stage: "done",
      completedAt: new Date(),
      intent: record.intent,
      projectId: record.projectId,
      variations: record.variations,
      result: JSON.parse(JSON.stringify({ ...response, balance: input.balance })),
    });
    log.info("generation.succeeded", {
      jobId: input.jobId,
      ms: Date.now() - started,
      source: response.source,
      lead: response.directions[0]?.layout === "Ideogram design" ? "ideogram" : "engine",
    });
    return { ok: true, response };
  } catch (error) {
    const code: FailureCode = error instanceof DirectorRefusal ? "GENERATION_BLOCKED" : "GENERATION_FAILED";
    // Nothing was delivered, so the charge is returned (idempotent on the job id — the
    // scheduled sweep uses the same key, so a refund is never doubled).
    const balance =
      input.cost > 0
        ? await addCredits({
            userId: input.userId,
            amount: input.cost,
            reason: "refund:generate",
            idempotencyKey: `refund:generate:${input.userId}:${input.jobId}`,
          }).catch(() => null)
        : null;

    if (input.freeFlyer) await returnFreeFlyer(input.userId).catch(() => undefined);

    const message = error instanceof Error ? error.message : String(error);
    await db()
      .insert(aiGenerationLogs)
      .values({ userId: input.userId, jobId: input.jobId, prompt: input.prompt, errorCode: code, message, details: { format: input.format, channel: input.channel ?? "web" } })
      .catch(() => undefined);
    await update({ status: "failed", errorCode: code, errorMessage: FAILURE_MESSAGES[code], completedAt: new Date() });
    log.error("generation.failed", { jobId: input.jobId, code, reason: message, ms: Date.now() - started });
    if (code === "GENERATION_FAILED") report?.(error, { jobId: input.jobId, format: input.format });
    return { ok: false, code, message: FAILURE_MESSAGES[code], balance };
  }
}
