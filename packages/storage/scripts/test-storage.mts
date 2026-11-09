/**
 * Storage helpers. Pure checks always run; with STORAGE_* set (R2, or e.g. a local MinIO) it
 * also does a real round trip: put → public read → head → signed download → delete.
 *   pnpm --filter @flyer/storage test
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { assertKey, deleteObject, headObject, keyFromPublicUrl, presignGet, publicUrl, putObject, sniffImage, storageConfig, storageConfigured } from "../src/index";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

console.log("storage");

await test("images are recognised by their bytes, not their name", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
});

await test("object keys are checked: no traversal, no odd characters", () => {
  assert.doesNotThrow(() => assertKey("0000-user/uploads/abc.png"));
  for (const bad of ["../x.png", "a/../../b", "/abs.png", "a b.png", "a//b.png", "x?y.png"]) assert.throws(() => assertKey(bad), bad);
});

await test("public URLs map back to their key, and only ours do", () => {
  const config = storageConfig({ STORAGE_ENDPOINT: "https://acc.r2.cloudflarestorage.com", STORAGE_ACCESS_KEY_ID: "k", STORAGE_SECRET_ACCESS_KEY: "s", STORAGE_PUBLIC_URL: "https://cdn.flyers.test/" } as NodeJS.ProcessEnv)!;
  assert.equal(config.publicUrl, "https://cdn.flyers.test");
  const url = publicUrl("u1/thumbs/p1.webp", config);
  assert.equal(url, "https://cdn.flyers.test/u1/thumbs/p1.webp");
  assert.equal(keyFromPublicUrl(`${url}?v=123`, config), "u1/thumbs/p1.webp");
  assert.equal(keyFromPublicUrl("https://evil.test/u1/thumbs/p1.webp", config), null);
  assert.equal(keyFromPublicUrl("https://cdn.flyers.test.evil.test/u1/x.png", config), null);
});

if (storageConfigured()) {
  console.log(`live round trip (${storageConfig()!.endpoint})`);
  const key = `storage-test/${randomUUID()}.png`;
  await test("put → public read → head → signed download → delete", async () => {
    const url = await putObject("public", key, PNG, { contentType: "image/png", cacheControl: "no-store" });
    const read = await fetch(url);
    assert.equal(read.status, 200, `public read of ${url}`);
    assert.deepEqual(new Uint8Array(await read.arrayBuffer()), PNG);
    assert.deepEqual(await headObject("public", key), { size: PNG.length, contentType: "image/png" });
    await deleteObject("public", key);
    assert.equal(await headObject("public", key), null);
  });
  await test("private objects: unreadable without a signature, downloadable with one", async () => {
    await putObject("private", key, PNG, { contentType: "image/png" });
    const config = storageConfig()!;
    const unsigned = await fetch(`${config.endpoint}/${config.buckets.private}/${key}`);
    assert.ok(unsigned.status === 403 || unsigned.status === 401, `unsigned read must be refused (got ${unsigned.status})`);
    const signed = await fetch(await presignGet("private", key, { expiresIn: 60, downloadName: "flyer.png" }));
    assert.equal(signed.status, 200);
    assert.match(signed.headers.get("content-disposition") ?? "", /attachment; filename="flyer.png"/);
    await deleteObject("private", key);
  });
} else {
  console.log("  (set STORAGE_* to also run a live round trip)");
}

console.log(`\n${passed} passed`);
