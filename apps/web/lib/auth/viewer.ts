import type { MeResponse } from "@flyer/core/api/contracts";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import type { Viewer } from "@/components/providers/viewer-provider";
import { ApiError } from "@/lib/api/client";
import { serverApi } from "@/lib/api/server";

/** The signed-in user and their profile (from the API), memoised per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Signed-in pages are always per-request, never prerendered at build time.
  await connection();
  try {
    return await serverApi<MeResponse>("/api/me");
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNAUTHORIZED") return null;
    throw error;
  }
});

export async function requireViewer(next = "/dashboard") {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}
