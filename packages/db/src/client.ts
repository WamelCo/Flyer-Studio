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
  const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX || 10) });
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
