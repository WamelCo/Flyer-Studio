# AI Generation Pipeline Rules

Flyers are **designed, not generated as images**. A text LLM acts as art director and returns
decisions; the layout engine (`packages/core/src/design/`) executes them as editable canvas nodes —
type, shapes, icons and photo frames — the way a graphic designer builds a layout.
Do not add image-generation models.

## Prompt Handling
1. Sanitize user input (length < 500 chars, strip malicious HTML) — `packages/core/src/ai/prompt.ts`.
2. Art direction (`packages/core/src/design/director.ts`, one shared system prompt, output validated against
   `BriefSchema`): category, tone, copy hierarchy, ranked layouts / palettes / type pairings
   from the fixed catalogues, photo search queries. The director is, in order of precedence:
   - Claude (`claude-opus-5-5`, structured output) when `ANTHROPIC_API_KEY` is set;
   - an open-weight model over an OpenAI-compatible API (`packages/core/src/design/open-model.ts`) when
     `LLM_PROVIDER` + `LLM_API_KEY` are set — default: Qwen on Groq's free tier; presets for
     Z.AI GLM Flash, DeepSeek, OpenRouter, Ollama and custom endpoints. Replies are cleaned,
     coerced and validated, with one repair round;
   - `rulesBrief()` otherwise.
3. Never invent facts (phone numbers, emails, addresses, prices, dates, brand names) — leave them empty.
   Enforced in code: `guardFacts()` (`packages/core/src/design/facts.ts`) strips every time, day, date, price,
   percentage, number and contact detail the prompt didn't state from model briefs, and corrects a
   part of day that contradicts the stated time. Keep its tests in `pnpm test:director` passing.
4. If the configured model is unavailable (rate limit, outage, timeout, unusable reply), fall back to
   `rulesBrief()` — a generation never fails just because the model did.
5. Test changes with `pnpm test:director` (mock provider); try a real key with `pnpm director:try "<prompt>"`.

## Design Principles (enforced by the engine)
- Colour: curated palettes with stated colour psychology; text must meet WCAG contrast
  (4.5:1 body, 3:1 display) — use `inkOn` / `mutedOn` / `softOn` / `readableOn`, never hard-code
  text colours or soften them with raw alpha. `pnpm audit:contrast` checks every layout × palette ×
  pairing × format and must pass after any engine or palette change.
- Type: pairings define display / emphasis / heading / body / label / script roles on a
  modular scale; measure text with `packages/core/src/design/metrics.ts` so nothing overflows.
- Layout: archetypes in `packages/core/src/design/archetypes/`; use `stack()` so low-priority copy is
  dropped rather than overlapped; keep generous margins.
- Decoration (the "spark"): the brief picks a decor level (minimal / balanced / bold) and up to
  three motifs from `packages/core/src/design/decor.ts`; `decorate()` places them only in the layout's free
  space, behind every text node, seeded so a brief always decorates the same way. Never draw
  decoration over type; each of the three directions leads with a different motif.

## Photos
- Stock photography from Unsplash (`packages/core/src/design/photos.ts`): hotlink, credit the photographer,
  ping the download endpoint when a photo is used. Users can also upload or fill empty frames.

## Safety
- If the art director refuses (a Claude refusal, or a provider content filter), return a generic error:
  "Could not generate design. Please try a different prompt."
- Log failures to `ai_generation_logs` table.

## Output
- Generate 3 variations by default — three distinct design directions (layout × palette × type).
- Store the brief and chosen variants on `generation_jobs.variations` (Prisma `GenerationJob.variations`); the first design becomes the project.
