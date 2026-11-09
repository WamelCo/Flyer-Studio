import { NextResponse } from "next/server";

import { handle, requireUser } from "@/lib/api/server";
import { getProfile } from "@flyer/billing/payments";

export const dynamic = "force-dynamic";

/** The caller's plan and balance — polled briefly after checkout while the webhook lands. */
export const GET = handle(async () => {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  return NextResponse.json({ id: profile.id, email: profile.email, plan: profile.plan, credits: profile.credits });
});
