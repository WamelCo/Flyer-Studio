import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/*
 * Cloudflare R2 over its S3-compatible API.
 *   public bucket  (R2_BUCKET_PUBLIC):  uploads and thumbnails. Served from R2_PUBLIC_URL
 *                  (an r2.dev URL or a custom domain) so Konva can load them with CORS.
 *   exports bucket (R2_BUCKET_EXPORTS): finished PNG/PDF files. Private; presigned GETs only.
 * The browser writes to both through short-lived presigned PUT URLs issued by this API.
 */

let client: S3Client | null = null;

function config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicBucket = process.env.R2_BUCKET_PUBLIC;
  const exportsBucket = process.env.R2_BUCKET_EXPORTS;
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!endpoint || !accessKeyId || !secretAccessKey || !publicBucket || !exportsBucket || !publicUrl) {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }
  return { endpoint, accessKeyId, secretAccessKey, publicBucket, exportsBucket, publicUrl };
}

function s3() {
  const { endpoint, accessKeyId, secretAccessKey } = config();
  client ??= new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // R2 rejects the CRC checksums newer SDKs add by default to presigned PUTs.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

export type BucketName = "public" | "exports";

function bucket(name: BucketName) {
  const { publicBucket, exportsBucket } = config();
  return name === "public" ? publicBucket : exportsBucket;
}

/** Public, CORS-enabled URL of an object in the public bucket. */
export function publicUrl(key: string) {
  return `${config().publicUrl}/${key}`;
}

/** Prefix every public object URL starts with — used to validate canvas image sources. */
export function publicUrlPrefix() {
  return `${config().publicUrl}/`;
}

export interface PresignedPut {
  url: string;
  /** Must be sent exactly as given: they are part of the signature. */
  headers: Record<string, string>;
}

/**
 * A presigned PUT for one object. Content-Type is signed, and when `contentLength` is
 * given so is Content-Length — the browser sets it from the body, so a file of any
 * other size is rejected by R2.
 */
export async function presignPut(options: {
  bucket: BucketName;
  key: string;
  contentType: string;
  contentLength?: number;
  expiresIn?: number;
}): Promise<PresignedPut> {
  const command = new PutObjectCommand({
    Bucket: bucket(options.bucket),
    Key: options.key,
    ContentType: options.contentType,
    ContentLength: options.contentLength,
  });
  const url = await getSignedUrl(s3(), command, {
    expiresIn: options.expiresIn ?? 300,
    signableHeaders: new Set(options.contentLength === undefined ? ["content-type"] : ["content-type", "content-length"]),
  });
  return { url, headers: { "Content-Type": options.contentType } };
}

/** A presigned GET (max 7 days). `downloadName` makes browsers save instead of display. */
export async function presignGet(options: { bucket: BucketName; key: string; expiresIn: number; downloadName?: string }) {
  const command = new GetObjectCommand({
    Bucket: bucket(options.bucket),
    Key: options.key,
    ResponseContentDisposition: options.downloadName ? `attachment; filename="${options.downloadName}"` : undefined,
  });
  return getSignedUrl(s3(), command, { expiresIn: options.expiresIn });
}

/** Size and type of an object, or null when it doesn't exist. */
export async function headObject(name: BucketName, key: string) {
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket(name), Key: key }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? "" };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === "NotFound") return null;
    throw error;
  }
}

export async function deleteObject(name: BucketName, key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(name), Key: key }));
}
