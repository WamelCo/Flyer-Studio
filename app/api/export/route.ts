import { NextResponse } from "next/server";
import { z } from "zod";

import type { ExportStartResponse } from "@/lib/api/contracts";
import { ApiException, handle, parseJson, requireUser } from "@/lib/api/server";
import { enforce, LIMITS } from "@/lib/rate-limit";
import { deductCredits, getProfile } from "@/lib/db/credits";
import { EXPORT_FORMATS } from "@/lib/export/formats";
import { isFormatAllowed, PLANS } from "@/lib/stripe/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  exportId: z.string().uuid(),
  projectId: z.string().uuid(),
  format: z.enum(["png", "pdf", "png-2k", "png-4k"]),
  /** What the client rendered; must match the plan's watermark rule. */
  watermarked: z.boolean(),
});

/**
 * Starts an export: checks the plan, deducts credits through the Postgres RPC (atomic,
 * never negative, idempotent on exportId) and returns a one-time signed upload slot.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  await enforce(LIMITS.export(user.id), "Exporting very quickly — wait a moment and try again.");
  const { exportId, projectId, format, watermarked } = await parseJson(request, Body);
  const profile = await getProfile(user.id);
  const plan = PLANS[profile.plan];
  const spec = EXPORT_FORMATS[format];

  if (!isFormatAllowed(profile.plan, format)) {
    throw new ApiException("PLAN_LOCKED", `${spec.label} export is included with Pro and Max.`, { format });
  }
  if (plan.watermark && !watermarked) {
    throw new ApiException("PLAN_LOCKED", "Watermark-free exports are included with Pro and Max.", { format });
  }

  // RLS: only the owner can see the project.
  const supabase = await createClient();
  const { data: project } = await supabase.from("flyer_projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) throw new ApiException("NOT_FOUND", "This project doesn't exist or isn't yours.");

  const admin = createAdminClient();
  const path = `${user.id}/${exportId}.${spec.extension}`;

  const { data: existing } = await admin.from("exports").select("user_id, status").eq("id", exportId).maybeSingle();
  if (existing && existing.user_id !== user.id) throw new ApiException("CONFLICT", "Export id already in use.");
  if (existing?.status === "complete") throw new ApiException("CONFLICT", "This export already finished.");

  const charge = await deductCredits({
    userId: user.id,
    amount: spec.cost,
    reason: `export:${format}`,
    idempotencyKey: `export:${user.id}:${exportId}`,
  });
  if (!charge.ok) {
    throw new ApiException(
      "INSUFFICIENT_CREDITS",
      `${spec.label} export needs ${spec.cost} credit${spec.cost === 1 ? "" : "s"}. You have ${charge.balance}.`,
      { required: spec.cost, balance: charge.balance },
    );
  }

  if (!existing) {
    const { error } = await admin.from("exports").insert({
      id: exportId,
      user_id: user.id,
      project_id: projectId,
      format,
      credits_spent: spec.cost,
      watermarked,
      storage_path: path,
    });
    // A concurrent retry with the same id may have inserted first; the charge above was idempotent.
    if (error && error.code !== "23505") throw new Error(`export insert failed: ${error.message}`);
  }

  const { data: slot, error: slotError } = await admin.storage.from("exports").createSignedUploadUrl(path, { upsert: true });
  if (slotError || !slot) throw new Error(`signed upload failed: ${slotError?.message}`);

  const response: ExportStartResponse = {
    exportId,
    path,
    uploadToken: slot.token,
    watermark: watermarked,
    balance: charge.balance,
    replay: Boolean(existing),
  };
  return NextResponse.json(response);
});
