import { randomUUID } from "node:crypto";
import { putObject } from "@flyer/storage";
import { NextResponse } from "next/server";

import { handle, requireUser } from "@/lib/api/server";
import { enforce, LIMITS } from "@/lib/rate-limit";
import { readImageUpload } from "@/lib/uploads";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * An image for the canvas (body: the file). Checked by its bytes, stored in the public
 * bucket under the user's own folder, and returned as a URL Konva can load with CORS.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  await enforce(LIMITS.upload(user.id), "Uploading very quickly — wait a moment and try again.");
  const { bytes, type, extension } = await readImageUpload(request, MAX_BYTES);
  const url = await putObject("public", `${user.id}/uploads/${randomUUID()}.${extension}`, bytes, {
    contentType: type,
    cacheControl: "public, max-age=31536000, immutable",
  });
  return NextResponse.json({ url });
});
