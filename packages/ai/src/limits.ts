import { hit } from "@flyer/db/rate-limit";
import { log } from "@flyer/log";

/**
 * Ideogram costs real money per image, so its use is capped per user and in total per
 * day (IDEOGRAM_DAILY_LIMIT, default 300). Over the cap, the lead is designed by the
 * layout engine instead — the user still gets three designs.
 */
export async function ideogramAllowed(userId: string) {
  const total = Number(process.env.IDEOGRAM_DAILY_LIMIT || 300);
  const perUser = Number(process.env.IDEOGRAM_USER_DAILY_LIMIT || 40);
  const [user, all] = await Promise.all([
    hit({ key: `ideogram:day:${userId}`, max: perUser, windowSeconds: 86_400 }),
    hit({ key: "ideogram:day:all", max: total, windowSeconds: 86_400 }),
  ]);
  if (!all.allowed) log.warn("ideogram.daily_cap_reached", { limit: total });
  return user.allowed && all.allowed;
}

