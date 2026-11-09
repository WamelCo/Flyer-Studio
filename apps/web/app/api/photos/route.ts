import { NextResponse } from "next/server";

import { ApiException, handle, requireUser } from "@/lib/api/server";
import { enforce, LIMITS } from "@/lib/rate-limit";
import { photosConfigured, searchPhotos } from "@flyer/design/photos";

export const dynamic = "force-dynamic";

/** Stock photo search for the editor's Image panel (Unsplash; key stays server-side). */
export const GET = handle(async (request: Request) => {
  const user = await requireUser();
  await enforce(LIMITS.photos(user.id), "Searching very quickly — wait a moment and try again.");
  if (!photosConfigured()) throw new ApiException("PHOTOS_NOT_CONFIGURED", "Stock photos aren't set up on this server yet.");
  const url = new URL(request.url);
  const query = (url.searchParams.get("query") ?? "").trim().slice(0, 80);
  if (query.length < 2) throw new ApiException("VALIDATION_ERROR", "Search for at least two letters.");
  const format = url.searchParams.get("format");
  const photos = await searchPhotos(query, {
    perPage: 12,
    format: format === "poster" || format === "square" || format === "story" || format === "landscape" ? format : undefined,
  }).catch(() => {
    throw new ApiException("PHOTOS_UNAVAILABLE", "Photo search is unavailable right now. Try again in a moment.");
  });
  return NextResponse.json({ photos });
});
