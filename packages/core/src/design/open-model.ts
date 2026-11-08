import { z } from "zod";

import { ARCHETYPE_IDS } from "./archetypes";
import { BriefSchema, CATEGORIES, type DesignBrief } from "./brief";
import { isHex } from "./color";
import { DECOR_LEVELS, MOTIF_IDS } from "./decor";
import { ICON_NAMES, type IconName } from "./engine";
import { PALETTE_IDS } from "./palettes";
import { PAIRING_IDS } from "./typography";

/**
 * Art direction from an open-weight model (Qwen, GLM, DeepSeek …) over any
 * OpenAI-compatible Chat Completions API. Configured entirely from env:
 *
 *   LLM_PROVIDER   groq | zai | deepseek | openrouter | ollama | custom
 *   LLM_API_KEY    the provider's key (not needed for a local Ollama)
 *   LLM_MODEL      optional for groq / zai / deepseek (a default is set), required otherwise
 *   LLM_BASE_URL   required for custom; overrides the preset otherwise
 *
 * Smaller open models drift from a schema more than frontier ones, so the reply is
 * cleaned (thinking blocks, code fences), coerced (near-miss ids, missing fields) and
 * validated against BriefSchema, with one repair round before the caller falls back.
 */

export const OPEN_PROVIDERS = ["groq", "zai", "deepseek", "openrouter", "ollama", "custom"] as const;
export type OpenProviderId = (typeof OPEN_PROVIDERS)[number];

interface Preset {
  name: string;
  baseUrl: string;
  /** Default open-weight model; providers without one need LLM_MODEL. */
  model?: string;
  /** json_schema = constrained decoding against the schema; json_object = valid JSON, schema in the prompt. */
  format: "json_schema" | "json_object";
  /** Provider-specific request fields (dropped automatically if the provider rejects them). */
  extra?: Record<string, unknown>;
  needsKey: boolean;
}

const PRESETS: Record<OpenProviderId, Preset> = {
  // Alibaba's Qwen on Groq's free tier: constrained JSON Schema decoding, very fast, US-hosted.
  groq: { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "qwen/qwen3.8-27b", format: "json_schema", extra: { reasoning_format: "hidden" }, needsKey: true },
  // Zhipu's GLM Flash models are free on Z.AI.
  zai: { name: "Z.AI", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.7-flash", format: "json_object", extra: { thinking: { type: "disabled" } }, needsKey: true },
  // Not free, but a fraction of a cent per brief.
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", format: "json_object", needsKey: true },
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", format: "json_object", needsKey: true },
  ollama: { name: "Ollama", baseUrl: "http://localhost:11434/v1", format: "json_object", needsKey: false },
  custom: { name: "Custom", baseUrl: "", format: "json_object", needsKey: false },
};

const TIMEOUT_MS = 40_000;

export interface OpenModelConfig {
  provider: OpenProviderId;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  format: Preset["format"];
  extra: Record<string, unknown>;
}

/**
 * The configured open model, or null when none is set up (or the config is incomplete).
 * `prefix` selects the primary (LLM_*) or the fallback provider (LLM_FALLBACK_*).
 */
export function openModelConfig(env: NodeJS.ProcessEnv = process.env, prefix: "LLM_" | "LLM_FALLBACK_" = "LLM_"): OpenModelConfig | null {
  const read = (name: string) => env[`${prefix}${name}`]?.trim() || undefined;
  const provider = read("PROVIDER")?.toLowerCase() as OpenProviderId | undefined;
  if (!provider || !OPEN_PROVIDERS.includes(provider)) return null;
  const preset = PRESETS[provider];
  const baseUrl = (read("BASE_URL") || preset.baseUrl).replace(/\/+$/, "");
  const model = read("MODEL") || preset.model;
  const apiKey = read("API_KEY") ?? null;
  if (!baseUrl || !model || (preset.needsKey && !apiKey)) return null;
  return { provider, name: preset.name, baseUrl, model, apiKey, format: preset.format, extra: preset.extra ?? {} };
}

/** Primary then fallback provider — free tiers have per-minute limits, so a second one absorbs bursts. */
export function openModelConfigs(env: NodeJS.ProcessEnv = process.env) {
  return [openModelConfig(env, "LLM_"), openModelConfig(env, "LLM_FALLBACK_")].filter((c): c is OpenModelConfig => Boolean(c));
}

export type OpenModelResult =
  | { kind: "brief"; brief: DesignBrief; model: string }
  | { kind: "refused"; reason: string }
  | { kind: "failed"; reason: string };

/** Ask the open model for a design brief. Never throws: the caller decides how to degrade. */
export async function briefFromOpenModel(config: OpenModelConfig, system: string, user: string): Promise<OpenModelResult> {
  const label = `${config.model} via ${config.name}`;
  // With constrained decoding the schema travels in response_format; repeating it in the
  // prompt would double the input tokens (free tiers meter tokens per minute).
  const messages: ChatMessage[] = [
    { role: "system", content: config.format === "json_schema" ? `${system}\n\nReply with only the JSON object.` : withSchema(system) },
    { role: "user", content: user },
  ];
  try {
    let reply = await complete(config, messages);
    if (reply.refused) return { kind: "refused", reason: reply.finishReason };

    let parsed = parseBrief(reply.content);
    if (!parsed.ok) {
      // One repair round: show the model exactly what was wrong.
      messages.push({ role: "assistant", content: reply.content }, { role: "user", content: `That reply did not match the schema: ${parsed.error}. Reply again with only the corrected JSON object.` });
      reply = await complete(config, messages);
      if (reply.refused) return { kind: "refused", reason: reply.finishReason };
      parsed = parseBrief(reply.content);
    }
    return parsed.ok ? { kind: "brief", brief: parsed.brief, model: label } : { kind: "failed", reason: `${label}: ${parsed.error}` };
  } catch (error) {
    return { kind: "failed", reason: `${label}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── Transport ───────────────────────────────────────────────────────────────

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function complete(config: OpenModelConfig, messages: ChatMessage[]) {
  const strict = config.format === "json_schema";
  const body = {
    model: config.model,
    messages,
    temperature: 0.7,
    max_tokens: 8192,
    response_format: strict ? { type: "json_schema", json_schema: { name: "design_brief", strict: true, schema: strictSchema() } } : { type: "json_object" },
    ...config.extra,
  };
  let response = await post(config, body);
  // Some models on a provider reject strict schemas or preset extras: retry once in plain
  // JSON mode, which needs the schema spelled out in the prompt instead.
  if (response.status === 400 && (strict || Object.keys(config.extra).length)) {
    const prompted = messages.map((m, i) => (i === 0 && m.role === "system" && !m.content.includes(SCHEMA_MARKER) ? { ...m, content: withSchema(m.content.replace(/\n\nReply with only the JSON object\.$/, "")) } : m));
    const plain: Record<string, unknown> = { model: body.model, messages: prompted, temperature: body.temperature, max_tokens: body.max_tokens, response_format: { type: "json_object" } };
    response = await post(config, plain);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`HTTP ${response.status}${response.status === 401 || response.status === 403 ? " (check LLM_API_KEY)" : response.status === 429 ? " (rate limited)" : ""} ${detail}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason ?? "unknown";
  return {
    content: choice?.message?.content ?? "",
    finishReason,
    // OpenAI-style moderation and Z.AI's "sensitive" both mean the provider declined.
    refused: finishReason === "content_filter" || finishReason === "sensitive",
  };
}

const MAX_RATE_LIMIT_WAIT_MS = 12_000;

/**
 * POST, waiting out short rate limits: free tiers meter tokens per minute and answer a
 * burst with "try again in 3.5s". Waiting that long (plus jitter, so a burst doesn't
 * retry in lockstep) beats falling back to the rules. Longer waits give up at once.
 */
async function post(config: OpenModelConfig, body: Record<string, unknown>) {
  let response = await send(config, body);
  for (let attempt = 0; attempt < 2 && response.status === 429; attempt++) {
    const wait = retryAfterMs(response, await response.clone().text().catch(() => ""));
    if (wait === null || wait > MAX_RATE_LIMIT_WAIT_MS) break;
    await new Promise((resolve) => setTimeout(resolve, wait + 250 + Math.random() * 1500));
    response = await send(config, body);
  }
  return response;
}

/** The provider's retry hint: a Retry-After header, or "try again in 1m2.5s" in the error text. */
export function retryAfterMs(response: Pick<Response, "headers">, text: string): number | null {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const match = text.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
  if (!match) return null;
  return (Number(match[1] ?? 0) * 60 + Number(match[2])) * 1000;
}

/** One retry for a dropped connection ("fetch failed"); timeouts are not retried. */
async function send(config: OpenModelConfig, body: Record<string, unknown>) {
  try {
    return await request(config, body);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw error;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return request(config, body);
  }
}

function request(config: OpenModelConfig, body: Record<string, unknown>) {
  return fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(config.apiKey && { authorization: `Bearer ${config.apiKey}` }) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

// ── Schema ──────────────────────────────────────────────────────────────────

let cachedSchema: Record<string, unknown> | null = null;

/** BriefSchema as JSON Schema, tightened for strict decoding (every field required, no extras). */
export function strictSchema() {
  if (cachedSchema) return cachedSchema;
  const schema = z.toJSONSchema(BriefSchema) as Record<string, unknown>;
  delete schema.$schema;
  const tighten = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(tighten);
    const obj = node as Record<string, unknown>;
    if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
      obj.additionalProperties = false;
      obj.required = Object.keys(obj.properties);
    }
    Object.values(obj).forEach(tighten);
  };
  tighten(schema);
  cachedSchema = schema;
  return schema;
}

const SCHEMA_MARKER = "It must match this JSON Schema exactly";

function withSchema(system: string) {
  return `${system}\n\nReply with a single JSON object and nothing else — no prose, no code fences. ${SCHEMA_MARKER} (use null for unknown text fields and [] for empty lists):\n${JSON.stringify(strictSchema())}`;
}

// ── Parsing and coercion ────────────────────────────────────────────────────

type Parsed = { ok: true; brief: DesignBrief } | { ok: false; error: string };

export function parseBrief(content: string): Parsed {
  const json = extractJson(content);
  if (json === undefined) return { ok: false, error: "no JSON object found" };
  const result = BriefSchema.safeParse(coerceBrief(json));
  if (result.success) return { ok: true, brief: result.data };
  const issues = result.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return { ok: false, error: issues.join("; ") };
}

/** The JSON object in a reply, ignoring thinking blocks, code fences and stray prose. */
export function extractJson(content: string): unknown {
  const text = content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const ICON_SET = new Set<string>(ICON_NAMES);
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const asTextList = (v: unknown) => (Array.isArray(v) ? v.map(asText).filter((s): s is string => Boolean(s)) : typeof v === "string" && v.trim() ? [v.trim()] : []);
const slug = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s_]+/g, "-") : "");
const pickIds = <T extends string>(v: unknown, ids: readonly T[]) => [...new Set(asTextList(v).map(slug).filter((id): id is T => (ids as readonly string[]).includes(id)))];
const iconOf = (v: unknown, fallback: IconName): IconName => {
  const id = slug(v);
  return ICON_SET.has(id) ? (id as IconName) : fallback;
};

/**
 * Near-misses become valid: "Swiss Type" → "swiss-type", a missing list → [], an unknown
 * icon → a neutral one, an unknown palette → dropped (the engine pads the choices).
 */
export function coerceBrief(raw: unknown): unknown {
  const r = asRecord(raw);
  const copy = asRecord(r.copy);
  const contact = asRecord(copy.contact);
  const category = slug(r.category).replace(/-/g, "_");
  return {
    category: (CATEGORIES as readonly string[]).includes(category) ? category : "other",
    audience: asText(r.audience) ?? "general public",
    tone: asTextList(r.tone).slice(0, 4),
    rationale: asText(r.rationale) ?? "",
    copy: {
      brand: asText(copy.brand),
      eyebrow: asText(copy.eyebrow),
      // Left missing on purpose: no headline fails validation and triggers the repair round.
      headline: asText(copy.headline) ?? undefined,
      emphasis: asText(copy.emphasis),
      subhead: asText(copy.subhead),
      bodyTitle: asText(copy.bodyTitle),
      body: asText(copy.body),
      bullets: asTextList(copy.bullets),
      features: (Array.isArray(copy.features) ? copy.features : []).map(asRecord).map((f) => ({
        title: asText(f.title) ?? "",
        text: asText(f.text) ?? "",
        icon: iconOf(f.icon, "check-circle"),
      })),
      details: (Array.isArray(copy.details) ? copy.details : []).map((d) => (typeof d === "string" ? { text: d } : asRecord(d))).map((d) => ({
        icon: iconOf(d.icon, "check"),
        text: asText(d.text) ?? "",
      })),
      cta: asText(copy.cta),
      contact: {
        phone: asText(contact.phone),
        email: asText(contact.email),
        website: asText(contact.website),
        address: asText(contact.address),
        social: asTextList(contact.social),
      },
    },
    layouts: pickIds(r.layouts, ARCHETYPE_IDS),
    palettes: pickIds(r.palettes, PALETTE_IDS),
    pairings: pickIds(r.pairings, PAIRING_IDS),
    decor: (DECOR_LEVELS as readonly string[]).includes(slug(r.decor)) ? slug(r.decor) : "balanced",
    motifs: pickIds(r.motifs, MOTIF_IDS).slice(0, 3),
    brandColor: isHex(asText(r.brandColor)) ? asText(r.brandColor) : null,
    photoQueries: asTextList(r.photoQueries).slice(0, 3),
  };
}
