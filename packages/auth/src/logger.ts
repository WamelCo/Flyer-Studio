import { isDatabaseUnavailable } from "@flyer/db";
import { log } from "@flyer/log";

type Level = "debug" | "info" | "warn" | "error";

/** One warning per 30 s while the database is down, not one per request. */
const OUTAGE_QUIET_MS = 30_000;
let lastOutageLog = 0;

/** Drizzle puts the query's parameters in its message — session tokens, codes. Never log them. */
const withoutParams = (message: string) => message.replace(/\s*params:[\s\S]*$/, "");

// A type, not an interface: log fields are a Record<string, unknown>.
export type ErrorFields = {
  name?: string;
  code?: string;
  message: string;
  cause?: string;
};

/** An error as log fields: name, code and messages, without query parameters. */
export function describeError(error: unknown): ErrorFields {
  if (!(error instanceof Error)) return { message: withoutParams(String(error)) };
  const cause = error.cause instanceof Error ? error.cause : undefined;
  const code = (cause as { code?: unknown } | undefined)?.code ?? (error as { code?: unknown }).code;
  return {
    name: error.name,
    ...(typeof code === "string" ? { code } : {}),
    message: withoutParams(error.message),
    ...(cause ? { cause: withoutParams(cause.message) } : {}),
  };
}

/**
 * Better Auth's logger, routed to our structured logs. Its default prints whole Drizzle
 * errors with console.error — the query parameters included (a session token), and as a
 * red overlay in development — for what is usually one problem: the database is down.
 */
export function authLog(level: Level, message: unknown, ...args: unknown[]) {
  const values = [message, ...args];
  const error = values.find((value) => value instanceof Error);
  if (values.some((value) => isDatabaseUnavailable(value))) {
    if (Date.now() - lastOutageLog > OUTAGE_QUIET_MS) {
      lastOutageLog = Date.now();
      log.warn("auth.database_unreachable", describeError(error));
    }
    return;
  }
  const fields = {
    ...(typeof message === "string" ? { message } : {}),
    ...(error ? { error: describeError(error) } : {}),
  };
  if (level === "error") log.error("auth.error", fields);
  else if (level === "warn") log.warn("auth.warn", fields);
  else log.debug("auth.log", fields);
}
