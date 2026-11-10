import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { Pool } from "pg";

import * as schema from "./schema";

export type Schema = typeof schema;
/** Any Drizzle Postgres database with our schema: node-postgres in the apps, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

// Kept on globalThis so dev-server hot reloads reuse one pool instead of leaking connections.
const state = globalThis as typeof globalThis & { __flyerDb?: { db: Db; pool: Pool | null } };

export function databaseConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.DATABASE_URL);
}

/** The shared database (DATABASE_URL). Throws DATABASE_NOT_CONFIGURED when unset. */
export function db(): Db {
  if (state.__flyerDb) return state.__flyerDb.db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    // A database that doesn't answer fails the request in seconds instead of hanging the page.
    connectionTimeoutMillis: 10_000,
  });
  // An idle client losing its connection (database restart) must not crash the process.
  pool.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "db.pool_error", message: error.message })));
  state.__flyerDb = { db: drizzle(pool, { schema }) as unknown as Db, pool };
  return state.__flyerDb.db;
}

/** Tests: run everything against another database (e.g. PGlite). */
export function useDb(instance: Db) {
  state.__flyerDb = { db: instance, pool: null };
}

export async function closeDb() {
  const current = state.__flyerDb;
  state.__flyerDb = undefined;
  await current?.pool?.end();
}

/** Raw SQL → rows (node-postgres and PGlite both return `{ rows }`). */
export async function query<T>(statement: SQL, database: Db = db()): Promise<T[]> {
  const result = (await database.execute(statement)) as unknown as { rows: T[] };
  return result.rows;
}

// Network errors, Postgres connection exceptions (class 08), shutdown / starting up
// (57P01–57P03) and "too many connections" (53300): the database isn't there right now.
const UNREACHABLE = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "57P01", "57P02", "57P03", "53300"]);
const UNREACHABLE_MESSAGE = /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/i;

/**
 * True when an error — or anything it wraps (Drizzle's `cause`, Better Auth's `cause`, the
 * `errors` of an AggregateError) — means the database can't be reached: stopped, restarting,
 * unreachable or out of connections. A bad query is not an outage.
 */
export function isDatabaseUnavailable(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  const { code, message, cause, errors } = error as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string" && (UNREACHABLE.has(code) || /^08[0-9A-Z]{3}$/.test(code))) return true;
  if (typeof message === "string" && UNREACHABLE_MESSAGE.test(message)) return true;
  if (Array.isArray(errors) && errors.some((inner) => isDatabaseUnavailable(inner, depth + 1))) return true;
  return isDatabaseUnavailable(cause, depth + 1);
}

/** The Postgres error behind a Drizzle error (Drizzle wraps it as `cause`). */
export function pgError(error: unknown): { message: string; code?: string } {
  const cause = (error as { cause?: unknown } | null)?.cause;
  for (const candidate of [cause, error]) {
    if (candidate && typeof candidate === "object" && typeof (candidate as { code?: unknown }).code === "string") {
      return { message: String((candidate as { message?: unknown }).message ?? ""), code: (candidate as { code: string }).code };
    }
  }
  const message = error instanceof Error ? `${error.message} ${cause instanceof Error ? cause.message : ""}`.trim() : String(error);
  return { message };
}
