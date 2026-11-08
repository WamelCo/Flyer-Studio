# AI Generation Pipeline Rules

Flyers are **designed first, rendered second**. A text LLM acts as art director and returns
decisions; the layout engine (`packages/core/src/design/`) executes them as editable canvas nodes —
type, shapes, icons and photo frames — the way a graphic designer builds a layout. Optionally a
renderer (Ideogram 4.5, see **Renderer** below) finishes that exact layout as a polished graphic.
The image model never designs: it receives the engine's finished layout as a structured brief.
Never ask an image model to "make a flyer" from the user's prompt.

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

## Design principles
- One source of truth: `packages/core/src/design/principles.ts` — hierarchy, grid, spacing rhythm,
  alignment, proximity, contrast, colour (60-30-10), typography, balance, whitespace, focal point,
  shape language, consistency, imagery, legibility. Each states the designer's rule, how the engine
  enforces it, a full directive and a short `cue` for prompts. Change principles there, not in prompts.

## Renderer (Ideogram)
- On when `IDEOGRAM_API_KEY` is set (`RENDERER=engine` turns it off). `render-prompt.ts` compiles a
  composed `FlyerDoc` into Ideogram's structured JSON prompt: every text node, shape, icon and photo
  frame becomes an element with an exact bbox (0–1000, `[y_min, x_min, y_max, x_max]`), its exact
  words and its colour palette.
- **Render only the chosen design.** `POST /api/generate` returns the three editable engine designs
  (stored on `generation_jobs.variations.designs`); `POST /api/generate/:jobId/render` **starts** a render of
  the one the user picks (Ideogram async mode) and returns at once; the client polls
  `GET /api/generate/:jobId/render/:variant`, and the first poll that sees it finished copies it into R2
  (renderer URLs expire) and makes it the project canvas as a locked full-page image node. Never hold an
  HTTP request open for a render: Ideogram takes 15–130s and has slow spells. Renders still pending after
  10 minutes are failed and refunded. The first render per generation is included;
  others cost `CREDIT_COSTS.render` (refunded on failure); re-opening a rendered design is free.
  Never render all variants up front — that triples the per-generation model cost.
- A render failure or refusal leaves the editable design untouched and charges nothing.
- Rules learned from testing — keep them (`pnpm test:render` checks each one offline):
  - Large empty regions must be declared as negative space **in the background prose by position**.
    Undeclared, the model fills them with invented copy (even words from the prompt); declared as
    bbox elements, it draws outlined panels around them.
  - A photo backdrop is the first element, full frame, "one single continuous photograph"; drop the
    grid and imagery cues for that layout or the model builds a collage.
  - Keep the style block to short cues. Long style sentences get rendered as text.
  - Colours: hex only in `color_palette` fields, names in prose (hex in prose wastes the budget).
  - Never drop text or structure (bullets, chips, icons) to fit the 10k-character budget; only decor
    from `decor.ts` is expendable. Dropped structure gets replaced by invented elements.
  - Generic text nodes get a role from their content (phone, email, URL, label-above) and small text
    a position word — otherwise the model relocates them semantically.
  - Photos inside frames: "no legible text, signs or logos" (otherwise garbled signage appears).
- Iterate with `pnpm render:try -- --fixture <name>` or `--prompt "<text>" --variant 0|1|2` (add `--dry`
  for a free price quote). Each real render costs $0.03 (low, default) / $0.06 (medium) / $0.10 (high).
## Hero imagery, requested style, references
- `imagery.ts` infers the hero (person or item, cut-out or framed) from the prompt: "cracked screen" → a phone
  with a shattered screen. A cut-out (background removed, soft shadow) only when the hero is the layout's only
  photo; beside other frames it stays framed. Frameless layouts stand it on the disc/colour card. Supporting
  frames never repeat the hero subject. Add rules to `HERO_RULES`, most specific first.
- Colours and layouts the owner asks for ("black and gold colours", "use navy", "minimal design") win over the
  director's picks (`requestedStyle` in `brief.ts`) and are stripped from the copy (`withoutStyleRequests`).
- A style reference (`reference.ts`) contributes colours measured from its pixels, its page tone (light pages keep
  a light palette; Swiss, always a colour field, goes last) and its structure from Ideogram Describe ($0.01).
  Never its people, products, names or words.

## Revisions
- `POST /api/projects/:id/revisions` → poll `GET …/revisions/:revisionId`; `POST …/:revisionId/undo` is free.
  `revisionTargets` (`revision.ts`) maps the instruction to design elements (quoted text, price, phone number,
  headline, button, brand, hero image); their boxes become the edit mask, so everything else is copied pixel for
  pixel. Global asks ("warmer colours", "the background") are unmasked. "the phone in the photo" is the hero,
  not the number. Costs `CREDIT_COSTS.revise`, refunded on failure or after 10 minutes.
- Measure with `pnpm --filter @flyer/api revise:try`: it reports the share of pixels changed and how much of
  that fell inside the targets (tested: 100% inside for price, button and hero edits).
- Cheaper non-Ideogram models were A/B tested and rejected: they read the structured JSON as plain text
  (Nano Banana printed "-4°", Z-Image printed hex codes, GPT Image ignored the layout, P-Image garbled copy).
