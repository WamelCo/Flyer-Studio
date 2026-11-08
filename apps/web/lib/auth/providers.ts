import type { AuthConfig } from "@flyer/core/api/contracts";

import { apiUrl } from "@/lib/env";

const FALLBACK: AuthConfig = { configured: false, google: false, otpLength: 6 };

/**
 * Which sign-in methods the API offers. The login page only shows Google once it works,
 * and sizes the code field to the API's OTP length.
 */
export async function authConfig(): Promise<AuthConfig> {
  try {
    const response = await fetch(`${apiUrl()}/api/config/auth`, { next: { revalidate: 60 } });
    if (!response.ok) return FALLBACK;
    return (await response.json()) as AuthConfig;
  } catch {
    return FALLBACK;
  }
}
