"use client";

import { ApiError, apiFetch } from "@/lib/api/client";
import type { GenerateAccepted, GenerateResponse, GenerationStatus } from "@/lib/api/contracts";
import type { FlyerFormat } from "@flyer/design/canvas/types";

const POLL_MS = 1200;
const GIVE_UP_MS = 4 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts a generation and resolves with its result. Handles both server modes: a 202
 * with a job id (background job, polled until done) and the legacy inline response.
 * `onStage` receives the server's real progress ("directing", "designing", …).
 */
export async function generateFlyer(
  request: { prompt: string; format: FlyerFormat },
  onStage: (stage: string) => void,
  onCharged?: (balance: number) => void,
): Promise<GenerateResponse> {
  const started = await apiFetch<GenerateResponse | GenerateAccepted>("/api/generate", { method: "POST", json: request });
  onCharged?.(started.balance);
  if ("docs" in started) return started;

  const deadline = Date.now() + GIVE_UP_MS;
  let misses = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let status: GenerationStatus;
    try {
      status = await apiFetch<GenerationStatus>(`/api/generate/${started.jobId}`, { cache: "no-store" });
      misses = 0;
    } catch (error) {
      // A dropped poll isn't a failed job: keep trying through brief network blips.
      if (error instanceof ApiError && (error.code === "NETWORK_ERROR" || error.status >= 500) && ++misses < 5) continue;
      throw error;
    }
    if (status.stage) onStage(status.stage);
    if (status.status === "succeeded" && status.result) return status.result;
    if (status.status === "failed") {
      throw new ApiError(status.error?.code ?? "GENERATION_FAILED", status.error?.message ?? "We couldn't design this flyer.", 502, { balance: status.balance });
    }
  }
  throw new ApiError("GENERATION_TIMEOUT", "This is taking longer than usual. Your design will appear in Projects when it's ready.", 504);
}
