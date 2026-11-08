/**
 * The async render flow against a local mock of Ideogram's API — no real generations.
 *   pnpm --filter @flyer/api test:render-async
 *
 * Covers what the start (POST) and poll (GET) render routes rely on: renders start with
 * async=true and return a generation id; polls stay pending through slow spells and rate
 * limits; a completed render is copied into storage; failures and refusals are reported.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const polls = new Map<string, number>();
let lastStartBody = "";

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });

const server = createServer(async (req, res) => {
  const url = req.url ?? "";
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Image URLs are signed links: no API key, like Ideogram's.
  if (url === "/img.png") {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(PNG);
  }
  if (req.headers["api-key"] !== "test-key") return send(401, { error: "unauthorized" });
  if (req.method === "POST" && url.startsWith("/v2/image/generate/")) {
    lastStartBody = await readBody(req);
    const id = lastStartBody.includes("REFUSE") ? "gen-refused" : `gen-${polls.size + 1}`;
    polls.set(id, 0);
    return send(200, { generation_kind: "sampling", generation_id: id, seed: 7 });
  }
  if (req.method === "GET" && url.startsWith("/v2/generations/")) {
    const id = decodeURIComponent(url.split("/").pop()!);
    if (!polls.has(id)) return send(404, { error: "Generation not found" });
    const n = polls.get(id)! + 1;
    polls.set(id, n);
    if (id === "gen-refused") return send(200, { generation_id: id, status: "failed", failure_reason: "content_policy_violation" });
    if (n === 2) return send(429, { error: "slow down" }); // rate-limited poll: still pending
    if (n < 4) return send(200, { generation_id: id, status: "pending" });
    const { port } = server.address() as AddressInfo;
    return send(200, {
      generation_id: id,
      status: "completed",
      response_type: "url",
      data: [{ object_type: "image.generation", url: `http://127.0.0.1:${port}/img.png`, seed: 42, resolution: "1664x2496", is_image_safe: true, prompt: "p" }],
    });
  }
  if (url === "/img.png") {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(PNG);
  }
  send(404, { error: "no route" });
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;
Object.assign(process.env, { IDEOGRAM_BASE_URL: `http://127.0.0.1:${port}`, IDEOGRAM_API_KEY: "test-key" });
delete process.env.IDEOGRAM_MODEL;
delete process.env.RENDERER;

// Imported after the env is set: the client reads its base URL at load time.
const { checkRender, renderFlyer, startRender } = await import("@flyer/core/design/ideogram");
const { collectRender, renderVariants, startDesignRender } = await import("../src/render");
const { composeDesign } = await import("@flyer/core/design/compose");
const { PALETTES } = await import("@flyer/core/design/palettes");
const { PAIRINGS } = await import("@flyer/core/design/typography");

const design = composeDesign({
  format: "poster",
  copy: {
    brand: "Test", eyebrow: null, headline: "Async render", emphasis: null, subhead: null, bodyTitle: null, body: null,
    bullets: [], features: [], details: [], cta: null, contact: { phone: null, email: null, website: null, address: null, social: [] },
  },
  variant: { archetype: "swiss-type", palette: "trust-blue", pairing: "geometric" },
  photos: [],
});
const meta = { archetype: "swiss-type" as const, palette: PALETTES["trust-blue"], pairing: PAIRINGS.geometric, subject: "a test flyer" };

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("async render");

await test("a render starts asynchronously and returns a generation id", async () => {
  const { generationId, prompt } = await startDesignRender(design, meta);
  assert.match(generationId, /^gen-\d+$/);
  assert.ok(prompt.compositional_deconstruction.elements.length > 0);
  assert.match(lastStartBody, /name="async"\r\n\r\ntrue/);
  assert.match(lastStartBody, /name="quality"\r\n\r\nlow/);
  assert.match(lastStartBody, /name="magic_prompt"\r\n\r\noff/);
});

await test("polls stay pending (including a rate-limited poll) until the render completes, then it is stored", async () => {
  const { generationId } = await startDesignRender(design, meta);
  const stored: Uint8Array[] = [];
  const store = async (bytes: Uint8Array) => {
    stored.push(bytes);
    return "https://cdn.example/render.png";
  };
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    const result = await collectRender(generationId, store);
    seen.push(result.status);
    if (result.status === "done") {
      assert.equal(result.url, "https://cdn.example/render.png");
      assert.equal(result.seed, 42);
      break;
    }
  }
  assert.deepEqual(seen, ["pending", "pending", "pending", "done"]);
  assert.equal(stored.length, 1);
  assert.deepEqual(Buffer.from(stored[0]!), PNG);
});

await test("a refused render is reported as a blocked failure", async () => {
  const id = await startRender({ ...(await startDesignRender(design, meta)).prompt, high_level_description: "REFUSE" }, "poster");
  const check = await checkRender(id);
  assert.equal(check.status, "failed");
  assert.equal(check.status === "failed" && check.blocked, true);
  const collected = await collectRender(id, async () => "unused");
  assert.equal(collected.status, "failed");
});

await test("an unknown generation id fails instead of polling forever", async () => {
  const check = await checkRender("gen-missing");
  assert.equal(check.status, "failed");
});

await test("renderFlyer (scripts) starts and polls to completion", async () => {
  const { prompt } = await startDesignRender(design, meta);
  const images = await renderFlyer(prompt, "poster", { pollMs: 10 });
  assert.equal(images[0]!.seed, 42);
});

await test("renderVariants delivers a locked full-page image node", async () => {
  process.env.IDEOGRAM_POLL_MS = "10";
  const [variant] = await renderVariants([design], [meta], async () => "https://cdn.example/v.png");
  assert.equal(variant!.rendered, true);
  const node = variant!.doc.nodes[0]!;
  assert.equal(node.type, "image");
  assert.equal(node.type === "image" && node.src, "https://cdn.example/v.png");
  assert.equal(node.locked, true);
});

console.log(`\n${passed} passed`);
server.close();
