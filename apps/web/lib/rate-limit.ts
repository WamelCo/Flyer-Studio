import { check, type Limit } from "@flyer/db/rate-limit";

import { ApiException } from "@/lib/api/server";

export { LIMITS, type Limit } from "@flyer/db/rate-limit";

/** Checks every limit (all counters advance) and throws RATE_LIMITED if any is exceeded. */
export async function enforce(limits: Limit[], message: string) {
  const { blocked, retryAfter } = await check(limits);
  if (blocked) throw new ApiException("RATE_LIMITED", message, { retryAfter });
}
