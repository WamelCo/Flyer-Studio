/**
 * Creates the two buckets and the public bucket's CORS rule (Konva loads its images
 * cross-origin and must be allowed to export them).
 *   pnpm storage:setup        (reads STORAGE_* and NEXT_PUBLIC_SITE_URL from the repo's .env.local)
 * On MinIO it also makes the public bucket anonymously readable; on R2 do that in the
 * dashboard (bucket → Settings → Custom domain), which this script reminds you of.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { s3Fetch, storageConfig } from "../src/index";

const envFile = resolve(import.meta.dirname, "../../../.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = storageConfig();
if (!config) {
  console.log("Set STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY and STORAGE_PUBLIC_URL first.");
  process.exit(1);
}
const origins = [process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000", ...(process.env.STORAGE_CORS_ORIGINS ?? "").split(",")].map((o) => o.trim()).filter(Boolean);

for (const name of [config.buckets.public, config.buckets.private]) {
  const response = await s3Fetch(`/${name}`, { method: "PUT" });
  const body = await response.text();
  if (response.ok) console.log(`created bucket ${name}`);
  else if (/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(body)) console.log(`bucket ${name} exists`);
  else throw new Error(`creating ${name}: HTTP ${response.status} ${body.slice(0, 200)}`);
}

const cors = `<CORSConfiguration><CORSRule>${origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join("")}<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><MaxAgeSeconds>86400</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
const corsResponse = await s3Fetch(`/${config.buckets.public}?cors`, {
  method: "PUT",
  body: cors,
  headers: { "content-type": "application/xml", "content-md5": createHash("md5").update(cors).digest("base64") },
});
console.log(corsResponse.ok ? `CORS on ${config.buckets.public}: GET from ${origins.join(", ")}` : `CORS not set (HTTP ${corsResponse.status}): ${(await corsResponse.text()).slice(0, 160)}`);

const policy = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Principal: { AWS: ["*"] }, Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${config.buckets.public}/*`] }],
});
const policyResponse = await s3Fetch(`/${config.buckets.public}?policy`, { method: "PUT", body: policy, headers: { "content-type": "application/json" } });
if (policyResponse.ok) console.log(`${config.buckets.public} is publicly readable at ${config.publicUrl}`);
else console.log(`Public read not set by API (expected on R2): in the Cloudflare dashboard give ${config.buckets.public} a custom domain and set STORAGE_PUBLIC_URL to it.`);
