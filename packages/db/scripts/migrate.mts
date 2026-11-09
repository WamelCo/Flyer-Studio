/**
 * Applies the SQL migrations in packages/db/drizzle (Drizzle's journal decides what is new).
 *   pnpm db:migrate                 (reads DATABASE_URL from the repo's .env.local)
 *   node dist/migrate.cjs           (the Docker image runs this before the web server starts)
 * Waits up to a minute for Postgres, so it can start alongside the database container.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const here = dirname(resolve(process.argv[1] ?? "."));
const envFile = resolve(here, "../../../.env.local");
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? join(here, "../drizzle");
  const pool = new Pool({ connectionString: url, max: 1 });

  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("select 1");
      break;
    } catch (error) {
      if (attempt >= 30) throw error;
      console.log(`waiting for Postgres (${(error as Error).message})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // One migrator at a time, even if two containers start together.
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(727274)");
    await migrate(drizzle(client), { migrationsFolder });
    console.log("migrations applied");
  } finally {
    await client.query("select pg_advisory_unlock(727274)").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
