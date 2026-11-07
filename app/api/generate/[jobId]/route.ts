import { NextResponse } from "next/server";

import type { GenerateResponse, GenerationStatus } from "@/lib/api/contracts";
import type { ApiErrorCode } from "@/lib/api/types";
import { ApiException, handle, requireUser } from "@/lib/api/server";
import { getBalance } from "@/lib/db/credits";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A generation job's progress, read with the caller's own session (RLS: owner only). */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/generate/[jobId]">) => {
  const user = await requireUser();
  const { jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new ApiException("NOT_FOUND", "That generation doesn't exist.");

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("generation_jobs")
    .select("status, stage, result, error_code, error_message")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) throw new ApiException("NOT_FOUND", "That generation doesn't exist.");

  const row = job as { status: GenerationStatus["status"]; stage: string | null; result: GenerateResponse | null; error_code: string | null; error_message: string | null };
  const status: GenerationStatus = { status: row.status, stage: row.stage };
  if (row.status === "succeeded" && row.result) status.result = row.result;
  if (row.status === "failed") {
    status.error = {
      code: (row.error_code as ApiErrorCode | null) ?? "GENERATION_FAILED",
      message: row.error_message ?? "We couldn't design this flyer. Your credits were returned — please try again.",
    };
    status.balance = await getBalance(user.id);
  }
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
});
