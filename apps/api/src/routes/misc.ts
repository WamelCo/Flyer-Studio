import type { AuthConfig, MeResponse } from "@flyer/core/api/contracts";
import { photosConfigured, searchPhotos, trackDownloads } from "@flyer/core/design/photos";
import { getProfile } from "@flyer/db";
import { Hono } from "hono";
import { z } from "zod";

import { googleConfigured, OTP_LENGTH } from "../auth";
import { ApiException, parseJson, type AppEnv } from "../http";
import { requireUser } from "../session";

/** The caller's plan and balance — polled briefly after checkout while the webhook lands. */
export const me = new Hono<AppEnv>().use(requireUser).get("/", async (c) => {
  const user = c.var.user;
  const profile = await getProfile(user.id, user.email);
  const response: MeResponse = { id: profile.id, email: profile.email || user.email, plan: profile.plan, credits: profile.credits };
  return c.json(response);
});

/** Public: which sign-in methods the login page should offer. */
export const config = new Hono<AppEnv>().get("/auth", (c) => {
  const response: AuthConfig = {
    configured: Boolean(process.env.BETTER_AUTH_SECRET),
    google: googleConfigured(),
    otpLength: OTP_LENGTH,
  };
  return c.json(response);
});

const Track = z.object({
  // Only Unsplash's own download endpoints are pinged.
  downloadLocation: z
    .string()
    .url()
    .refine((value) => new URL(value).hostname === "api.unsplash.com", "Not an Unsplash download URL"),
});

export const photos = new Hono<AppEnv>()
  .use(requireUser)

  /** Stock photo search for the editor's Image panel (Unsplash; key stays server-side). */
  .get("/", async (c) => {
    if (!photosConfigured()) throw new ApiException("PHOTOS_NOT_CONFIGURED", "Stock photos aren't set up on this server yet.");
    const query = (c.req.query("query") ?? "").trim().slice(0, 80);
    if (query.length < 2) throw new ApiException("VALIDATION_ERROR", "Search for at least two letters.");
    const format = c.req.query("format");
    const results = await searchPhotos(query, {
      perPage: 12,
      format: format === "poster" || format === "square" || format === "story" || format === "landscape" ? format : undefined,
    }).catch(() => {
      throw new ApiException("PHOTOS_UNAVAILABLE", "Photo search is unavailable right now. Try again in a moment.");
    });
    return c.json({ photos: results });
  })

  /** Unsplash requires a download ping whenever a user places one of its photos. */
  .post("/track", async (c) => {
    const { downloadLocation } = await parseJson(c, Track);
    trackDownloads([{ downloadLocation }]);
    return c.json({ tracked: true });
  });
