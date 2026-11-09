// The container's entrypoint: one container runs the whole studio.
//
//   1. Postgres — embedded, data in /data/postgres — unless DATABASE_URL points elsewhere
//   2. migrations (packages/db/drizzle)
//   3. the web app (Next.js standalone, port 3000)
//   4. the WhatsApp service (Hono + whatsapp-web.js, 127.0.0.1:3001) unless WHATSAPP=off
//
// If any of them stops, everything stops and Docker's restart policy starts it again.
// Secrets the operator didn't set (Better Auth, the internal API) are generated once and
// kept in /data/secrets, so sessions survive restarts.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA = process.env.DATA_DIR || "/data";
const PG_BIN = process.env.PG_BIN || "/usr/lib/postgresql/15/bin";
const children = new Map();
let stopping = false;

const log = (event, fields = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event: `container.${event}`, ...fields }));

function secret(name, envName) {
  if (process.env[envName]) return process.env[envName];
  const dir = join(DATA, "secrets");
  const file = join(dir, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("base64url"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

function start(name, command, args, env = {}) {
  const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
  children.set(name, child);
  child.on("exit", (code, signal) => {
    children.delete(name);
    if (!stopping) {
      console.error(JSON.stringify({ level: "error", event: "container.child_exited", name, code, signal }));
      void shutdown(1);
    }
  });
  return child;
}

async function waitFor(check, what, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${what} did not become ready`);
}

async function embeddedPostgres() {
  const pgdata = join(DATA, "postgres");
  if (!existsSync(join(pgdata, "PG_VERSION"))) {
    mkdirSync(pgdata, { recursive: true, mode: 0o700 });
    log("postgres_init", { pgdata });
    const init = spawnSync(join(PG_BIN, "initdb"), ["-D", pgdata, "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--locale=C.UTF-8", "-U", "flyer"], { stdio: "inherit" });
    if (init.status !== 0) throw new Error("initdb failed");
  }
  // Reachable only from inside this container (127.0.0.1), so local trust auth is safe.
  start("postgres", join(PG_BIN, "postgres"), ["-D", pgdata, "-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=/tmp", "-p", "5432"]);
  const ready = () => spawnSync(join(PG_BIN, "pg_isready"), ["-h", "127.0.0.1", "-p", "5432", "-U", "flyer"]).status === 0;
  await waitFor(ready, "Postgres");
  const exists = spawnSync(join(PG_BIN, "psql"), ["-h", "127.0.0.1", "-U", "flyer", "-d", "postgres", "-tAc", "select 1 from pg_database where datname = 'flyer'"], { encoding: "utf8" });
  if (!exists.stdout?.includes("1")) spawnSync(join(PG_BIN, "createdb"), ["-h", "127.0.0.1", "-U", "flyer", "flyer"], { stdio: "inherit" });
  return "postgres://flyer@127.0.0.1:5432/flyer";
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  log("stopping", { code });
  // Apps first, the database last.
  for (const name of ["web", "whatsapp"]) children.get(name)?.kill("SIGTERM");
  await waitFor(() => !children.has("web") && !children.has("whatsapp"), "apps", 20).catch(() => undefined);
  children.get("postgres")?.kill("SIGINT"); // fast shutdown
  await waitFor(() => !children.has("postgres"), "postgres", 30).catch(() => undefined);
  process.exit(code);
}
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));

try {
  const databaseUrl = process.env.DATABASE_URL || (await embeddedPostgres());
  const shared = {
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: secret("better-auth", "BETTER_AUTH_SECRET"),
    INTERNAL_API_SECRET: secret("internal-api", "INTERNAL_API_SECRET"),
  };

  const migrate = spawnSync("node", ["/app/db/migrate.cjs"], { stdio: "inherit", env: { ...process.env, ...shared } });
  if (migrate.status !== 0) throw new Error("migrations failed");

  const whatsapp = process.env.WHATSAPP !== "off";
  if (whatsapp) {
    start("whatsapp", "node", ["/app/whatsapp/dist/index.mjs"], { ...shared, WHATSAPP_HOST: process.env.WHATSAPP_HOST || "127.0.0.1", WHATSAPP_PORT: "3001" });
  }
  start("web", "node", ["/app/web/apps/web/server.js"], {
    ...shared,
    PORT: process.env.PORT || "3000",
    HOSTNAME: "0.0.0.0",
    ...(whatsapp && { WHATSAPP_SERVICE_URL: "http://127.0.0.1:3001" }),
  });
  log("started", { database: process.env.DATABASE_URL ? "external" : "embedded", whatsapp });
} catch (error) {
  console.error(JSON.stringify({ level: "error", event: "container.start_failed", message: error instanceof Error ? error.message : String(error) }));
  await shutdown(1);
}
