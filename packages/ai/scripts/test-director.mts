/**
 * Open-model art director, tested against a local mock of an OpenAI-compatible API.
 *   pnpm test:director
 * Covers: messy replies (thinking blocks, fences, near-miss ids), the repair round,
 * providers that reject strict schemas, rate limits, refusals and the rules fallback.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { directDesign } from "../src/director";
import { guardFacts } from "../src/facts";
import { briefFromOpenModel, coerceBrief, openModelConfig, outputLimitFrom, parseBrief, retryAfterMs, strictSchema, type OpenModelConfig } from "../src/open-model";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const good = {
  category: "event",
  audience: "jazz fans",
  tone: ["warm", "intimate"],
  rationale: "Gold on near-black reads as evening luxury.",
  copy: {
    brand: "The Blue Room", eyebrow: "Live", headline: "Summer Jazz Night", emphasis: "Jazz", subhead: null, bodyTitle: null, body: null,
    bullets: [], features: [], details: [{ icon: "calendar", text: "Friday, 8pm" }], cta: "Get tickets",
    contact: { phone: null, email: null, website: null, address: null, social: [] },
  },
  layouts: ["photo-overlay", "swiss-type", "bold-stack"],
  palettes: ["luxe-gold", "neon-party", "tech-violet"],
  pairings: ["elegant", "poster-condensed", "tech"],
  brandColor: null,
  photoQueries: ["jazz saxophone stage"],
};

console.log("schema");
await test("strict JSON Schema: every object closed, every field required", () => {
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object" && obj.properties) {
      assert.equal(obj.additionalProperties, false);
      assert.deepEqual([...(obj.required as string[])].sort(), Object.keys(obj.properties as object).sort());
    }
    Object.values(obj).forEach(visit);
  };
  const schema = strictSchema();
  visit(schema);
  assert.ok(!("$schema" in schema));
});

console.log("parsing");
await test("clean JSON parses; missing decor defaults to balanced", () => {
  const parsed = parseBrief(JSON.stringify(good));
  assert.ok(parsed.ok);
  assert.equal(parsed.brief.decor, "balanced");
});
await test("thinking block, code fence and prose are ignored", () => {
  const reply = `<think>The user wants jazz… gold feels right.</think>\nHere is the brief:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\nHope this helps!`;
  const parsed = parseBrief(reply);
  assert.ok(parsed.ok);
  assert.equal(parsed.brief.copy.headline, "Summer Jazz Night");
});
await test("near-miss ids and shapes are coerced", () => {
  const messy = {
    ...good,
    category: "Real Estate",
    tone: "calm",
    layouts: ["Swiss Type", "photo_overlay", "made-up-layout"],
    palettes: ["LUXE GOLD"],
    copy: { ...good.copy, bullets: "Free parking", details: ["Friday 8pm", { icon: "rocket-ship", text: "Main hall" }], contact: undefined },
    photoQueries: "jazz club",
    decor: "Bold",
    motifs: ["Confetti", "glitter", "bokeh"],
  };
  const parsed = parseBrief(JSON.stringify(messy));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  const b = parsed.brief;
  assert.equal(b.decor, "bold");
  assert.deepEqual(b.motifs, ["confetti", "bokeh"]);
  assert.equal(b.category, "real_estate");
  assert.deepEqual(b.tone, ["calm"]);
  assert.deepEqual(b.layouts, ["swiss-type", "photo-overlay"]);
  assert.deepEqual(b.palettes, ["luxe-gold"]);
  assert.deepEqual(b.copy.bullets, ["Free parking"]);
  assert.deepEqual(b.copy.details, [{ icon: "check", text: "Friday 8pm" }, { icon: "check", text: "Main hall" }]);
  assert.deepEqual(b.copy.contact, { phone: null, email: null, website: null, address: null, social: [] });
  assert.deepEqual(b.photoQueries, ["jazz club"]);
});
await test("a missing headline fails (so the repair round runs)", () => {
  const parsed = parseBrief(JSON.stringify({ ...good, copy: { ...good.copy, headline: undefined } }));
  assert.ok(!parsed.ok);
  assert.match(parsed.error, /copy\.headline/);
});
await test("no JSON at all fails cleanly", () => assert.ok(!parseBrief("Sorry, I can't help with that.").ok));
await test("invalid brand colours are dropped, valid ones kept", () => {
  assert.equal((coerceBrief({ ...good, brandColor: "blue" }) as { brandColor: unknown }).brandColor, null);
  assert.equal((coerceBrief({ ...good, brandColor: "#0A84FF" }) as { brandColor: unknown }).brandColor, "#0A84FF");
});

console.log("facts");
await test("invented times, deadlines, prices and contacts are removed (the real party example)", () => {
  const prompt = "Kids birthday party for Mia turning 6, Saturday 2pm";
  const brief = parseBrief(JSON.stringify({
    ...good,
    copy: {
      ...good.copy,
      headline: "Mia Turns 6",
      emphasis: "6",
      eyebrow: "Come celebrate with us",
      subhead: "Fun under the summer sun",
      body: "Games, giggles and cake all afternoon. Doors close at 5pm.",
      details: [
        { icon: "calendar", text: "Saturday, 2:00 pm" },
        { icon: "clock", text: "Party until 5:00 pm" },
        { icon: "gift", text: "Cake & ice cream at 4pm" },
        { icon: "ticket", text: "Free entry for all" },
      ],
      features: [{ title: "Her 6th birthday", text: "A big day for Mia.", icon: "party" }],
      cta: "RSVP by Thursday",
      contact: { phone: "555-123-4567", email: "mia@example.com", website: null, address: null, social: [] },
    },
  }));
  assert.ok(brief.ok);
  const { brief: clean, removed } = guardFacts(brief.brief, prompt);
  const c = clean.copy;
  assert.equal(c.headline, "Mia Turns 6");
  assert.equal(c.emphasis, "6");
  assert.equal(c.subhead, "Fun under the summer sun", "'sun' is not Sunday");
  assert.equal(c.body, "Games, giggles and cake all afternoon.");
  assert.deepEqual(c.details.map((d) => d.text), ["Saturday, 2:00 pm"]);
  assert.equal(c.features[0]?.title, "Her 6th birthday");
  assert.equal(c.cta, "RSVP");
  assert.equal(c.contact.phone, null);
  assert.equal(c.contact.email, null);
  assert.ok(removed >= 5);
});
await test("a part of day that contradicts the stated time is corrected", () => {
  const fix = (prompt: string, subhead: string) => {
    const brief = parseBrief(JSON.stringify({ ...good, copy: { ...good.copy, subhead } }));
    assert.ok(brief.ok);
    return guardFacts(brief.brief, prompt).brief.copy.subhead;
  };
  assert.equal(fix("Kids party Saturday 2pm", "A magical morning of fun"), "A magical afternoon of fun");
  assert.equal(fix("Jazz Friday 8pm", "A night of soul"), "A night of soul");
  assert.equal(fix("Jazz Friday 8pm", "Morning grooves"), "Evening grooves");
  assert.equal(fix("Bake sale this weekend", "A sunny morning treat"), "A sunny morning treat", "no stated time: leave it");
});
await test("stated facts survive in any spelling (8:00 PM, $15.00, 1pm–4pm, 50%)", () => {
  const check = (prompt: string, lines: string[]) => {
    const brief = parseBrief(JSON.stringify({ ...good, copy: { ...good.copy, details: lines.map((text) => ({ icon: "calendar", text })) } }));
    assert.ok(brief.ok);
    return guardFacts(brief.brief, prompt).brief.copy.details.map((d) => d.text);
  };
  assert.deepEqual(check("Summer jazz night at the Blue Room, Friday 8pm, tickets $15", ["Friday", "8:00 PM", "$15.00 tickets", "Tickets $15"]), ["Friday", "8:00 PM", "$15.00 tickets", "Tickets $15"]);
  assert.deepEqual(check("Open house Sunday 1–4pm, 3 bed modern home", ["Sunday 1-4pm", "1pm to 4pm", "3 bedrooms", "Open 9am"]), ["Sunday 1-4pm", "1pm to 4pm", "3 bedrooms"]);
  assert.deepEqual(check("50% off everything this weekend", ["50% off", "70% off shoes"]), ["50% off"]);
  assert.deepEqual(check("Call 0803 555 1234 for bookings", ["0803 555 1234", "0803-555-1234", "Call 0700 000 0000"]), ["0803 555 1234", "0803-555-1234"]);
});

console.log("config");
await test("no provider → null; missing key → null; presets fill base URL and model", () => {
  assert.equal(openModelConfig({}), null);
  assert.equal(openModelConfig({ LLM_PROVIDER: "groq" }), null);
  const groq = openModelConfig({ LLM_PROVIDER: "groq", LLM_API_KEY: "k" })!;
  assert.equal(groq.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(groq.format, "json_schema");
  assert.ok(groq.model);
  assert.equal(openModelConfig({ LLM_PROVIDER: "openrouter", LLM_API_KEY: "k" }), null, "openrouter needs LLM_MODEL");
  assert.equal(openModelConfig({ LLM_PROVIDER: "ollama", LLM_MODEL: "qwen3:8b" })!.apiKey, null);
  assert.equal(openModelConfig({ LLM_PROVIDER: "custom", LLM_MODEL: "m" }), null, "custom needs LLM_BASE_URL");
});

// ── Mock provider ───────────────────────────────────────────────────────────

type Handler = (body: Record<string, unknown>, call: number) => { status?: number; content?: string; finish?: string; retryAfter?: string; message?: string };
let handler: Handler = () => ({ content: JSON.stringify(good) });
const calls: Record<string, unknown>[] = [];
const server = createServer(async (req: IncomingMessage, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw) as Record<string, unknown>;
  calls.push({ ...body, auth: req.headers.authorization });
  const out = handler(body, calls.length);
  res.writeHead(out.status ?? 200, { "content-type": "application/json", ...(out.retryAfter && { "retry-after": out.retryAfter }) });
  res.end(out.status && out.status >= 400 ? JSON.stringify({ error: { message: out.message ?? "mock error" } }) : JSON.stringify({ choices: [{ message: { content: out.content ?? "" }, finish_reason: out.finish ?? "stop" }] }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const config = (format: OpenModelConfig["format"], extra: Record<string, unknown> = {}): OpenModelConfig => ({ provider: "custom", name: "Mock", baseUrl, model: "mock-qwen", apiKey: "test-key", format, extra });
const reset = (h: Handler) => {
  handler = h;
  calls.length = 0;
};

console.log("transport");
await test("strict mode sends the JSON Schema, the key and the extras", async () => {
  reset(() => ({ content: JSON.stringify(good) }));
  const result = await briefFromOpenModel(config("json_schema", { reasoning_format: "hidden" }), "system", "user");
  assert.equal(result.kind, "brief");
  assert.equal(calls.length, 1);
  const rf = calls[0]!.response_format as { type: string; json_schema: { strict: boolean } };
  assert.equal(rf.type, "json_schema");
  assert.equal(rf.json_schema.strict, true);
  assert.equal(calls[0]!.reasoning_format, "hidden");
  assert.equal(calls[0]!.auth, "Bearer test-key");
});
await test("a 400 on strict schema retries once in plain JSON mode without extras", async () => {
  reset((body) => ((body.response_format as { type: string }).type === "json_schema" ? { status: 400 } : { content: JSON.stringify(good) }));
  const result = await briefFromOpenModel(config("json_schema", { reasoning_format: "hidden" }), "system", "user");
  assert.equal(result.kind, "brief");
  assert.equal(calls.length, 2);
  assert.equal((calls[1]!.response_format as { type: string }).type, "json_object");
  assert.ok(!("reasoning_format" in calls[1]!));
  // Strict mode keeps the schema out of the prompt (it's in response_format); plain mode needs it back.
  const system = (n: number) => (calls[n]!.messages as { content: string }[])[0]!.content;
  assert.ok(!system(0).includes("JSON Schema exactly"));
  assert.ok(system(1).includes("JSON Schema exactly"));
});
await test("an unusable reply gets one repair round with the errors", async () => {
  reset((_, n) => ({ content: n === 1 ? JSON.stringify({ ...good, copy: { ...good.copy, headline: null } }) : JSON.stringify(good) }));
  const result = await briefFromOpenModel(config("json_object"), "system", "user");
  assert.equal(result.kind, "brief");
  assert.equal(calls.length, 2);
  const repair = (calls[1]!.messages as { role: string; content: string }[]).at(-1)!;
  assert.equal(repair.role, "user");
  assert.match(repair.content, /copy\.headline/);
});
await test("still unusable after repair → failed (caller falls back)", async () => {
  reset(() => ({ content: "no json here" }));
  const result = await briefFromOpenModel(config("json_object"), "system", "user");
  assert.equal(result.kind, "failed");
  assert.equal(calls.length, 2);
});
await test("rate limit with no hint or a long wait → failed at once, no retry storm", async () => {
  for (const retryAfter of [undefined, "60"]) {
    reset(() => ({ status: 429, retryAfter }));
    const result = await briefFromOpenModel(config("json_object"), "system", "user");
    assert.equal(result.kind, "failed");
    assert.match(result.kind === "failed" ? result.reason : "", /rate limited/);
    assert.equal(calls.length, 1);
  }
});
await test("a limit that persists gives up after two short waits", async () => {
  reset(() => ({ status: 429, retryAfter: "0.1" }));
  const result = await briefFromOpenModel(config("json_object"), "system", "user");
  assert.equal(result.kind, "failed");
  assert.equal(calls.length, 3);
});
await test("a short rate limit is waited out (provider's retry hint), then succeeds", async () => {
  reset((_, n) => (n === 1 ? { status: 429, retryAfter: "0.2" } : { content: JSON.stringify(good) }));
  const started = Date.now();
  const result = await briefFromOpenModel(config("json_object"), "system", "user");
  assert.equal(result.kind, "brief");
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started >= 250, "waited before retrying");
});
await test("retry hints parse from the header or Groq's message", () => {
  const none = { headers: new Headers() };
  assert.equal(retryAfterMs({ headers: new Headers({ "retry-after": "2" }) }, ""), 2000);
  assert.equal(Math.round(retryAfterMs(none, "Please try again in 3.514285714s. Need more tokens?")!), 3514);
  assert.equal(retryAfterMs(none, "try again in 1m2.5s"), 62500);
  assert.equal(retryAfterMs(none, "slow down"), null);
});
const TOO_LARGE =
  "Request too large for model `qwen` on output tokens per minute (OTPM): Limit 1000, Requested 1600. The request's expected output tokens exceed the enforced limit; reduce max_tokens";
await test("an allowance over the provider's per-minute output limit is lowered once and remembered", async () => {
  assert.equal(outputLimitFrom(429, TOO_LARGE), 1000);
  assert.equal(outputLimitFrom(429, "Rate limit reached … Limit 1000, Used 994, Requested 702. Please try again in 41s"), null, "an ordinary rate limit waits instead");
  reset((body) => (Number(body.max_tokens) > 1000 ? { status: 429, message: TOO_LARGE } : { content: JSON.stringify(good) }));
  const capped = { ...config("json_schema"), model: "mock-capped" };
  assert.equal((await briefFromOpenModel(capped, "system", "user")).kind, "brief");
  assert.deepEqual(calls.map((c) => c.max_tokens), [8192, 1000]);
  reset((body) => (Number(body.max_tokens) > 1000 ? { status: 429, message: TOO_LARGE } : { content: JSON.stringify(good) }));
  assert.equal((await briefFromOpenModel(capped, "system", "user")).kind, "brief");
  assert.deepEqual(calls.map((c) => c.max_tokens), [1000], "no wasted request the second time");
});
await test("content filter / sensitive → refused", async () => {
  for (const finish of ["content_filter", "sensitive"]) {
    reset(() => ({ content: "", finish }));
    const result = await briefFromOpenModel(config("json_object"), "system", "user");
    assert.equal(result.kind, "refused");
  }
});

console.log("director");
await test("directDesign uses the open model when configured, rules when it fails", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  Object.assign(process.env, { LLM_PROVIDER: "custom", LLM_BASE_URL: baseUrl, LLM_MODEL: "mock-qwen", LLM_API_KEY: "test-key" });
  reset(() => ({ content: JSON.stringify(good) }));
  const ok = await directDesign("Summer jazz night at the Blue Room", "poster");
  assert.equal(ok.source, "open-model");
  assert.equal(ok.model, "mock-qwen via Custom");
  assert.equal(ok.brief.copy.headline, "Summer Jazz Night");

  reset(() => ({ status: 503 }));
  const errors = console.error;
  console.error = () => undefined;
  const fallback = await directDesign("Summer jazz night at the Blue Room, Friday 8pm", "poster");
  console.error = errors;
  assert.equal(fallback.source, "rules");
  assert.ok(fallback.brief.copy.headline.length > 0);
});
await test("primary down → the fallback provider (LLM_FALLBACK_*) directs", async () => {
  Object.assign(process.env, { LLM_FALLBACK_PROVIDER: "custom", LLM_FALLBACK_BASE_URL: baseUrl, LLM_FALLBACK_MODEL: "mock-glm" });
  reset((body) => (body.model === "mock-qwen" ? { status: 503 } : { content: JSON.stringify(good) }));
  const errors = console.error;
  console.error = () => undefined;
  const result = await directDesign("Summer jazz night", "poster");
  console.error = errors;
  assert.equal(result.source, "open-model");
  assert.equal(result.model, "mock-glm via Custom");
  delete process.env.LLM_FALLBACK_PROVIDER;
});
await test("a policy violation in the brief stops the design as a refusal; a clean verdict passes", async () => {
  reset(() => ({ content: JSON.stringify({ ...good, safety: { violation: true, category: "violence" } }) }));
  await assert.rejects(directDesign("something violent", "poster"), (error: Error) => error.constructor.name === "DirectorRefusal" && /violence/.test(error.message));
  reset(() => ({ content: JSON.stringify({ ...good, safety: { violation: false, category: null } }) }));
  assert.equal((await directDesign("Summer jazz night", "poster")).source, "open-model");
  reset(() => ({ content: JSON.stringify(good) })); // no verdict at all: treated as clean
  assert.equal((await directDesign("Summer jazz night", "poster")).brief.safety.violation, false);
});
await test("a refusal surfaces as DirectorRefusal (the route shows the generic message)", async () => {
  reset(() => ({ content: "", finish: "content_filter" }));
  await assert.rejects(directDesign("something", "poster"), (error: Error) => error.constructor.name === "DirectorRefusal");
});

server.close();
console.log(`\n${passed} passed`);
