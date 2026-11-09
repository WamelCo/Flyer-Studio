import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseJson, requireUser } from "@/lib/api/server";
import { enforce, LIMITS } from "@/lib/rate-limit";
import { trackDownloads } from "@flyer/design/photos";

const Body = z.object({
  // Only Unsplash's own download endpoints are pinged.
  downloadLocation: z.string().url().refine((value) => new URL(value).hostname === "api.unsplash.com", "Not an Unsplash download URL"),
});

/** Unsplash requires a download ping whenever a user places one of its photos. */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  await enforce(LIMITS.photos(user.id), "Too many requests — wait a moment and try again.");
  const { downloadLocation } = await parseJson(request, Body);
  trackDownloads([{ downloadLocation }]);
  return NextResponse.json({ tracked: true });
});
