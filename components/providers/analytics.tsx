"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { trackPageview } from "@/lib/monitoring";

/** Page views for PostHog (no-op without NEXT_PUBLIC_POSTHOG_KEY). Paths only, never query strings. */
export function Analytics() {
  const pathname = usePathname();
  useEffect(() => trackPageview(), [pathname]);
  return null;
}
