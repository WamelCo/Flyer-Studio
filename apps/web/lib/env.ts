/** Typed access to configuration. */

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** The Hono API as reached from this server (not the browser — it uses the /api rewrite). */
export function apiUrl() {
  return (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
}
