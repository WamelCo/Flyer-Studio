// Runs the production build the way the container does: the standalone server, with the
// static assets copied next to it (Next leaves that step to the deployer).
//   pnpm start            (after pnpm build; PORT defaults to 3000)
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const app = join(import.meta.dirname, "..");
const server = join(app, ".next", "standalone", "apps", "web", "server.js");
if (!existsSync(server)) {
  console.error("No standalone build found: run pnpm build first.");
  process.exit(1);
}
cpSync(join(app, ".next", "static"), join(app, ".next", "standalone", "apps", "web", ".next", "static"), { recursive: true });
process.env.HOSTNAME ??= "0.0.0.0";
process.env.FLYER_FONTS_DIR ??= join(app, "..", "..", "packages", "design", "assets", "fonts");
await import(new URL(`file:///${server.replace(/\\/g, "/")}`).href);
