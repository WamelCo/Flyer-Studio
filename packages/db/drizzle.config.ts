import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` diffs src/schema.ts against the last snapshot and writes the next SQL migration.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/flyer" },
});
