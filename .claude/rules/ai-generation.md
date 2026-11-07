# AI Generation Pipeline Rules

Every flyer ends up as **editable canvas layers**, never a flat picture. A text LLM acts as art
director and writes the brief and exact copy. Of the three directions:
- the **lead** is designed by **Ideogram 4.5** (`lib/design/ideogram.ts`) when `IDEOGRAM_API_KEY`
  is set: the art director's `artwork` concept + the copy in quotes (Magic Prompt off). Layerize
  (`/v2/design/layerize/ideogram-3`) then removes the text; the text-free artwork becomes a locked
  background stored in our `flyers` bucket (Ideogram URLs expire), and each detected text block
  becomes an editable text layer re-typed with the approved copy (`lib/design/ideogram-layers.ts`).
  Text Ideogram invents is dropped. On any failure the engine designs that direction instead.
- the other two are composed by the layout engine (`lib/design/`) — type, shapes, icons, photo
  frames — the way a graphic designer builds a layout.
Ideogram is the only image model; it is used for artwork, never for final text.

## Prompt Handling
0. Generation is a background job (`lib/generation/`): POST /api/generate rate-limits
   (`lib/rate-limit.ts`), charges credits, creates the `generation_jobs` row and returns 202;
   the pipeline runs in `after()`, writing `stage` + `heartbeat_at`; the client polls
   GET /api/generate/[jobId]. Failures refund with key `refund:generate:<user>:<job>`; the
   database sweeper fails and refunds jobs silent for 5 minutes. Before the Phase 0 migration
   is applied the same pipeline runs inline. Ideogram use is capped per user and per day.
1. Sanitize user input (length < 500 chars, strip malicious HTML) — `lib/ai/prompt.ts`.
2. Art direction (`lib/design/director.ts`, one shared system prompt, output validated against
   `BriefSchema`): category, tone, copy hierarchy, ranked layouts / palettes / type pairings
   from the fixed catalogues, photo search queries. The director is, in order of precedence:
   - Claude (`claude-opus-5-5`, structured output) when `ANTHROPIC_API_KEY` is set;
   - an open-weight model over an OpenAI-compatible API (`lib/design/open-model.ts`) when
     `LLM_PROVIDER` + `LLM_API_KEY` are set — default: Qwen on Groq's free tier; presets for
     Z.AI GLM Flash, DeepSeek, OpenRouter, Ollama and custom endpoints. Replies are cleaned,
     coerced and validated, with one repair round;
   - `rulesBrief()` otherwise.
3. Never invent facts (phone numbers, emails, addresses, prices, dates, brand names) — leave them empty.
   Enforced in code: `guardFacts()` (`lib/design/facts.ts`) strips every time, day, date, price,
   percentage, number and contact detail the prompt didn't state from model briefs, and corrects a
   part of day that contradicts the stated time. Keep its tests in `pnpm test:director` passing.
4. If the configured model is unavailable (rate limit, outage, timeout, unusable reply), fall back to
   `rulesBrief()` — a generation never fails just because the model did.
5. Follow the request: the brief's `requirements` lists every explicit instruction (imagery, style,
   colours, words, layout wishes) and each must be honoured; named colours go in `colors` and
   override the palette (`withBrandColor` primary + accent, contrast recomputed).
6. Test changes with `pnpm test:director` and `pnpm test:ideogram` (mock providers); try real keys
   with `pnpm director:try "<prompt>"`; price Ideogram with `pnpm ideogram:quote` (dry run).

## Design Principles (enforced by the engine)
- Colour: curated palettes with stated colour psychology; text must meet WCAG contrast
  (4.5:1 body, 3:1 display) — use `inkOn` / `mutedOn` / `softOn` / `readableOn`, never hard-code
  text colours or soften them with raw alpha. `pnpm audit:contrast` checks every layout × palette ×
  pairing × format and must pass after any engine or palette change.
- Type: pairings define display / emphasis / heading / body / label / script roles on a
  modular scale; measure text with `lib/design/metrics.ts` so nothing overflows.
- Layout: archetypes in `lib/design/archetypes/`; use `stack()` so low-priority copy is
  dropped rather than overlapped; keep generous margins.
- Decoration (the "spark"): the brief picks a decor level (minimal / balanced / bold) and up to
  three motifs from `lib/design/decor.ts`; `decorate()` places them only in the layout's free
  space, behind every text node, seeded so a brief always decorates the same way. Never draw
  decoration over type; each of the three directions leads with a different motif.

## Photos
- Stock photography from Unsplash (`lib/design/photos.ts`): hotlink, credit the photographer,
  ping the download endpoint when a photo is used. Users can also upload or fill empty frames.

## Safety
- Content policy: the brief's `safety` verdict (policy text in the director's system prompt) is
  checked before any paid image generation; a violation is a refusal. Political campaigns,
  rallies, protests, religious services and nightlife are allowed — don't tighten that without
  the owner.
- If the art director refuses (a policy violation, a Claude refusal, or a provider content
  filter), return a generic error: "Could not generate design. Please try a different prompt."
- Log failures to `ai_generation_logs` table.

## Output
- Generate 3 variations by default — three distinct design directions (layout × palette × type);
  with Ideogram configured: 1 Ideogram lead (first palette/pairing) + 2 engine directions.
- Ideogram costs real money per image: keep the lead to one image per generation unless the
  credit prices in `lib/stripe/plans.ts` are raised to match.
- Store the brief and chosen variants on `generation_jobs.variations`; the first design becomes the project.
