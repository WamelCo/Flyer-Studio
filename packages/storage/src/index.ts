import { AwsClient } from "aws4fetch";

/**
 * Object storage over the S3 API: Cloudflare R2 in production (zero egress), MinIO or any
 * S3-compatible service elsewhere. Two buckets:
 *   public  (STORAGE_PUBLIC_BUCKET, "flyers")  generated art, uploads, thumbnails — served
 *           from STORAGE_PUBLIC_URL (an R2 custom domain) with CORS so Konva can export them.
 *   private (STORAGE_PRIVATE_BUCKET, "exports") finished files — short-lived signed links only.
 * Paths are always `<userId>/…`, chosen by the server.
 */

export type Bucket = "public" | "private";

export interface StorageConfig {
  /** https://<account id>.r2.cloudflarestorage.com, or http://localhost:9000 for MinIO. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** "auto" for R2. */
  region: string;
  buckets: Record<Bucket, string>;
  /** Public base URL of the public bucket, no trailing slash. */
  publicUrl: string;
}

export class StorageError extends Error {}

const trim = (value: string) => value.replace(/\/+$/, "");

export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const { STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_PUBLIC_URL } = env;
  if (!STORAGE_ENDPOINT || !STORAGE_ACCESS_KEY_ID || !STORAGE_SECRET_ACCESS_KEY || !STORAGE_PUBLIC_URL) return null;
  return {
    endpoint: trim(STORAGE_ENDPOINT),
    accessKeyId: STORAGE_ACCESS_KEY_ID,
    secretAccessKey: STORAGE_SECRET_ACCESS_KEY,
    region: env.STORAGE_REGION || "auto",
    buckets: { public: env.STORAGE_PUBLIC_BUCKET || "flyers", private: env.STORAGE_PRIVATE_BUCKET || "exports" },
    publicUrl: trim(STORAGE_PUBLIC_URL),
  };
}

export function storageConfigured(env: NodeJS.ProcessEnv = process.env) {
  return storageConfig(env) !== null;
}

function required(config = storageConfig()) {
  if (!config) throw new StorageError("STORAGE_NOT_CONFIGURED");
  return config;
}

let cached: { key: string; client: AwsClient } | null = null;
function signer(config: StorageConfig) {
  const key = `${config.accessKeyId}:${config.region}`;
  if (cached?.key !== key) {
    cached = { key, client: new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: config.region }) };
  }
  return cached.client;
}

/** Path-style URL (works for R2's account endpoint and MinIO). Each segment is encoded. */
export function objectUrl(config: StorageConfig, bucket: Bucket | string, key: string) {
  const name = bucket === "public" || bucket === "private" ? config.buckets[bucket] : bucket;
  return `${config.endpoint}/${name}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function assertKey(key: string) {
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(key) || key.includes("..")) throw new StorageError(`invalid object key: ${key}`);
}

export async function putObject(
  bucket: Bucket,
  key: string,
  body: Uint8Array | ArrayBuffer | Blob,
  { contentType, cacheControl }: { contentType: string; cacheControl?: string },
) {
  assertKey(key);
  const config = required();
  const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body instanceof ArrayBuffer ? new Uint8Array(body) : body;
  const response = await signer(config).fetch(objectUrl(config, bucket, key), {
    method: "PUT",
    body: bytes as BodyInit,
    headers: { "content-type": contentType, ...(cacheControl && { "cache-control": cacheControl }) },
  });
  if (!response.ok) throw new StorageError(`put ${bucket}/${key} failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  return bucket === "public" ? publicUrl(key, config) : objectUrl(config, bucket, key);
}

/** Size and type of an object, or null when it does not exist. */
export async function headObject(bucket: Bucket, key: string): Promise<{ size: number; contentType: string | null } | null> {
  assertKey(key);
  const config = required();
  const response = await signer(config).fetch(objectUrl(config, bucket, key), { method: "HEAD" });
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageError(`head ${bucket}/${key} failed: HTTP ${response.status}`);
  return { size: Number(response.headers.get("content-length") ?? 0), contentType: response.headers.get("content-type") };
}

export async function deleteObject(bucket: Bucket, key: string) {
  assertKey(key);
  const config = required();
  const response = await signer(config).fetch(objectUrl(config, bucket, key), { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new StorageError(`delete ${bucket}/${key} failed: HTTP ${response.status}`);
}

/** A time-limited GET link to a private object; `downloadName` makes browsers save it. */
export async function presignGet(bucket: Bucket, key: string, { expiresIn = 3600, downloadName }: { expiresIn?: number; downloadName?: string } = {}) {
  assertKey(key);
  const config = required();
  const url = new URL(objectUrl(config, bucket, key));
  url.searchParams.set("X-Amz-Expires", String(Math.min(604_800, Math.max(1, Math.round(expiresIn)))));
  if (downloadName) url.searchParams.set("response-content-disposition", `attachment; filename="${downloadName.replace(/["\\]/g, "")}"`);
  const signed = await signer(config).sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

/** The public URL of an object in the public bucket. */
export function publicUrl(key: string, config = required()) {
  return `${config.publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** The object key behind one of our public URLs (query string ignored), or null. */
export function keyFromPublicUrl(url: string, config = storageConfig()): string | null {
  if (!config) return null;
  const base = `${config.publicUrl}/`;
  const bare = url.split("?")[0]!;
  if (!bare.startsWith(base)) return null;
  try {
    return bare.slice(base.length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

/** Origin of the public bucket (for the Content-Security-Policy and next/image). */
export function publicOrigin(env: NodeJS.ProcessEnv = process.env) {
  try {
    return env.STORAGE_PUBLIC_URL ? new URL(env.STORAGE_PUBLIC_URL).origin : null;
  } catch {
    return null;
  }
}

/** Signs any S3 request (bucket setup scripts). */
export async function s3Fetch(path: string, init: RequestInit = {}) {
  const config = required();
  return signer(config).fetch(`${config.endpoint}${path}`, init);
}

/** What a stored image may be, by its bytes (never trust the declared type alone). */
export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
