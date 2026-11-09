/**
 * Try the configured art director on a real prompt (reads .env.local).
 *   pnpm director:try "Summer jazz night at the Blue Room, Friday 8pm, tickets $15"
 * Checks the model exists on the provider, then prints the brief and how long it took.
 */
import { directDesign } from "../src/director";
import { openModelConfig } from "../src/open-model";

const prompt = process.argv.slice(2).join(" ") || "Summer jazz night at the Blue Room, Friday 8pm, tickets $15";
const config = openModelConfig();

if (process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY is set, so Claude directs (it takes precedence over LLM_PROVIDER).");
} else if (!config) {
  console.log("No open model configured: set LLM_PROVIDER and LLM_API_KEY in .env.local (see .env.example). Showing the rules brief.");
} else {
  console.log(`Provider: ${config.name} (${config.baseUrl})  model: ${config.model}  key: ${config.apiKey ? "set" : "none"}`);
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const ids = ((await response.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
      if (ids.length && !ids.includes(config.model)) {
        const similar = ids.filter((id) => /qwen|glm|deepseek|kimi|minimax/i.test(id)).slice(0, 12);
        console.log(`⚠ "${config.model}" is not in this provider's model list. Set LLM_MODEL to one of:\n  ${(similar.length ? similar : ids.slice(0, 12)).join("\n  ")}`);
      } else if (ids.length) {
        console.log(`✓ model is available (${ids.length} models on this provider)`);
      }
    } else {
      console.log(`Model list: HTTP ${response.status}${response.status === 401 ? " — the key was rejected" : ""}`);
    }
  } catch (error) {
    console.log(`Model list unavailable: ${(error as Error).message}`);
  }
}

const started = Date.now();
const { brief, source, model } = await directDesign(prompt, "poster");
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\nDirected by: ${model} (${source}) in ${seconds}s`);
console.log(`Category: ${brief.category} · tone: ${brief.tone.join(", ") || "—"}`);
console.log(`Headline: ${brief.copy.eyebrow ? `[${brief.copy.eyebrow}] ` : ""}${brief.copy.headline}${brief.copy.emphasis ? `  (emphasis: ${brief.copy.emphasis})` : ""}`);
if (brief.copy.subhead) console.log(`Subhead:  ${brief.copy.subhead}`);
if (brief.copy.details.length) console.log(`Details:  ${brief.copy.details.map((d) => `${d.icon}: ${d.text}`).join(" · ")}`);
console.log(`Layouts:  ${brief.layouts.join(", ")}`);
console.log(`Palettes: ${brief.palettes.join(", ")}`);
console.log(`Pairings: ${brief.pairings.join(", ")}`);
console.log(`Decor:    ${brief.decor} · ${brief.motifs.join(", ") || "—"}`);
console.log(`Asked:    ${brief.requirements.join(" · ") || "—"}`);
console.log(`Colours:  ${brief.colors.join(", ") || "—"}`);
console.log(`Artwork:  ${brief.artwork || "—"}`);
console.log(`Photos:   ${brief.photoQueries.join(" | ") || "—"}`);
console.log(`Why:      ${brief.rationale}`);
