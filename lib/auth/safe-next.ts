/** Only same-origin paths are valid post-login destinations (prevents open redirects). */
export function safeNext(value: string | null | undefined, fallback = "/dashboard") {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;
}
