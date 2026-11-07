/**
 * Structured logs: one JSON object per line, so any log drain (Vercel, Datadog, Axiom,
 * Supabase) can filter by `event`, `jobId`, `userId`. Never log prompts' personal
 * details beyond what's needed, and never secrets.
 */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function write(level: Level, event: string, fields: Fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }, (_key, value) =>
    value instanceof Error ? { name: value.name, message: value.message } : value,
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level !== "debug" || process.env.LOG_LEVEL === "debug") console.log(line);
}

export const log = {
  debug: (event: string, fields?: Fields) => write("debug", event, fields),
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
