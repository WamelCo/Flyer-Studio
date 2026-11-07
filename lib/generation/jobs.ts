import type { ApiErrorCode } from "@/lib/api/types";
import type { GenerateResponse } from "@/lib/api/contracts";
import { addCredits } from "@/lib/db/credits";
import type { TablesUpdate } from "@/lib/db/types";
import { DirectorRefusal } from "@/lib/design/director";
import { designFlyer, type GenerationInput, type Stage } from "@/lib/generation/pipeline";
import { log } from "@/lib/log";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Generation jobs (Phase 0). POST /api/generate charges credits, creates a `pending` row
 * and starts the work after the response (Next.js `after()`); the client polls
 * GET /api/generate/[jobId] for `stage` and finally `result`. Every step writes a
 * heartbeat; the database sweeper fails and refunds any job silent for 5 minutes.
 *
 * Until the Phase 0 migration is applied, jobs run inside the request as before.
 */

let readiness: { ready: boolean; checkedAt: number } | null = null;

/** Whether the background-job columns exist (cached for five minutes). */
export async function jobsReady() {
  if (readiness && Date.now() - readiness.checkedAt < 5 * 60_000) return readiness.ready;
  const { error } = await createAdminClient().from("generation_jobs").select("stage, heartbeat_at").limit(1);
  const ready = !error;
  if (!ready) log.warn("jobs.migration_missing", { reason: error.message, hint: "apply supabase/migrations/20261107000000_phase0_jobs_rate_limits.sql" });
  readiness = { ready, checkedAt: Date.now() };
  return ready;
}

export async function createJob(input: GenerationInput) {
  const { error } = await createAdminClient().from("generation_jobs").insert({
    id: input.jobId,
    user_id: input.userId,
    prompt: input.prompt,
    intent: "event", // refined from the brief when the job finishes
    format: input.format,
    status: "pending",
    stage: "queued",
    credits_spent: input.cost,
    heartbeat_at: new Date().toISOString(),
  });
  if (error) throw new Error(`job insert failed: ${error.message}`);
}

export type RunOutcome =
  | { ok: true; response: GenerateResponse }
  | { ok: false; code: Extract<ApiErrorCode, "GENERATION_BLOCKED" | "GENERATION_FAILED">; message: string; balance: number };

export const FAILURE_MESSAGES = {
  GENERATION_BLOCKED: "Could not generate design. Please try a different prompt.",
  GENERATION_FAILED: "We couldn't design this flyer. Your credits were returned — please try again.",
} as const;

/**
 * Runs one generation to completion. `background`: progress and the outcome are written
 * to the job row. `inline` (migration not applied): the legacy job row is written at the
 * end and the outcome returned to the request.
 */
export async function runJob(input: GenerationInput & { balance: number }, mode: "background" | "inline"): Promise<RunOutcome> {
  const admin = createAdminClient();
  const started = Date.now();
  const update = async (fields: TablesUpdate<"generation_jobs">) => {
    if (mode !== "background") return;
    const { error } = await admin.from("generation_jobs").update(fields).eq("id", input.jobId);
    if (error) log.warn("jobs.update_failed", { jobId: input.jobId, reason: error.message });
  };
  const onStage = async (stage: Stage) => {
    await update({ stage, heartbeat_at: new Date().toISOString() });
    log.debug("generation.stage", { jobId: input.jobId, stage, ms: Date.now() - started });
  };

  await update({ status: "running", started_at: new Date().toISOString() });
  if (mode === "inline") {
    // The project row references its job, so the job row must exist first (legacy columns only).
    const { error } = await admin
      .from("generation_jobs")
      .insert({ id: input.jobId, user_id: input.userId, prompt: input.prompt, format: input.format, credits_spent: input.cost, intent: "event" });
    if (error) log.warn("jobs.insert_failed", { jobId: input.jobId, reason: error.message });
  }
  log.info("generation.started", { jobId: input.jobId, userId: input.userId, format: input.format, mode });

  try {
    const { response: partial, record } = await designFlyer(input, onStage);
    const response: GenerateResponse = { ...partial, balance: input.balance };
    const finished = { status: "succeeded", completed_at: new Date().toISOString(), ...record };

    if (mode === "background") {
      await update({ ...finished, stage: "done", result: JSON.parse(JSON.stringify(response)) });
    } else {
      await admin.from("generation_jobs").update(finished).eq("id", input.jobId);
    }
    log.info("generation.succeeded", {
      jobId: input.jobId,
      ms: Date.now() - started,
      source: response.source,
      lead: response.directions[0]?.layout === "Ideogram design" ? "ideogram" : "engine",
    });
    return { ok: true, response };
  } catch (error) {
    const code = error instanceof DirectorRefusal ? "GENERATION_BLOCKED" : "GENERATION_FAILED";
    // Nothing was delivered, so the charge is returned (idempotent on the job id — the
    // database sweeper uses the same key, so a refund is never doubled).
    const balance = await addCredits({
      userId: input.userId,
      amount: input.cost,
      reason: "refund:generate",
      idempotencyKey: `refund:generate:${input.userId}:${input.jobId}`,
    }).catch(() => input.balance);

    const message = error instanceof Error ? error.message : String(error);
    await admin.from("ai_generation_logs").insert({ user_id: input.userId, prompt: input.prompt, error_code: code, message, details: { format: input.format, jobId: input.jobId } });
    if (mode === "background") {
      await update({ status: "failed", error_code: code, error_message: FAILURE_MESSAGES[code], completed_at: new Date().toISOString() });
    } else {
      await admin.from("generation_jobs").update({ status: "failed", error_code: code, completed_at: new Date().toISOString() }).eq("id", input.jobId);
    }
    log.error("generation.failed", { jobId: input.jobId, code, reason: message, ms: Date.now() - started });
    if (code === "GENERATION_FAILED") reportError(error, { jobId: input.jobId, format: input.format });
    return { ok: false, code, message: FAILURE_MESSAGES[code], balance };
  }
}
