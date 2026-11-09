import { isPhoneEmail } from "@flyer/auth";
import { getProfile } from "@flyer/billing/payments";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import type { Viewer } from "@/components/providers/viewer-provider";
import { getSession } from "@/lib/auth/server";

/** The signed-in user and their profile, memoised per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Signed-in pages are always per-request, never prerendered at build time.
  await connection();
  const session = await getSession();
  if (!session) return null;
  const { user } = session;
  const phone = (user as { phoneNumber?: string | null }).phoneNumber ?? null;
  const profile = await getProfile(user.id);
  return {
    id: user.id,
    // WhatsApp-only accounts have a placeholder email: show their number instead.
    email: isPhoneEmail(user.email) ? (phone ?? "WhatsApp account") : user.email,
    plan: profile.plan,
    credits: profile.credits,
  };
});

export async function requireViewer(next = "/dashboard") {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}
