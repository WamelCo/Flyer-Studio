# AI Generation Pipeline Rules

Every flyer ends up as **editable canvas layers**, never a flat picture. A text LLM acts as art
director and writes the brief and exact copy. Of the three directions:
- the **lead** is designed by **Ideogram 4.5** (`packages/ai/src/ideogram.ts`) when `IDEOGRAM_API_KEY`
  is set: the art director's `artwork` concept + the copy in quotes (Magic Prompt off). Layerize
  (`/v2/design/layerize/ideogram-3`) then removes the text; the text-free artwork becomes a locked
  background stored in our `flyers` bucket (Ideogram URLs expire), and each detected text block
  becomes an editable text layer re-typed with the approved copy (`packages/ai/src/ideogram-layers.ts`).
  Text Ideogram invents is dropped. On any failure the engine designs that direction instead.
- the other two are composed by the layout engine (`packages/design/src/`) — type, shapes, icons, photo
  frames — the way a graphic designer builds a layout.
Ideogram is the only image model; it is used for artwork, never for final text.

## Prompt Handling
0. Generation is a background job (`packages/ai/src/pipeline.ts`, `jobs.ts`): POST /api/generate rate-limits
   (`packages/db/src/rate-limit.ts`), charges credits, creates the `generation_jobs` row and returns 202;
   the pipeline runs in `after()`, writing `stage` + `heartbeat_at`; the client polls
   GET /api/generate/[jobId]. Failures refund with key `refund:generate:<user>:<job>`; the
   scheduled sweep (`packages/db/src/maintenance.ts`) fails and refunds jobs silent for 5 minutes.
   WhatsApp generations (apps/whatsapp) use the same job runner with channel `whatsapp`. Ideogram use is capped per user and per day.
1. Sanitize user input (length < 500 chars, strip malicious HTML) — `packages/ai/src/prompt.ts`.
2. Art direction (`packages/ai/src/director.ts`, one shared system prompt, output validated against
   `BriefSchema`): category, tone, copy hierarchy, ranked layouts / palettes / type pairings
   from the fixed catalogues, photo search queries. The director is, in order of precedence:
   - Claude (`claude-opus-5-5`, structured output) when `ANTHROPIC_API_KEY` is set;
   - an open-weight model over an OpenAI-compatible API (`packages/ai/src/open-model.ts`) when
     `LLM_PROVIDER` + `LLM_API_KEY` are set — default: Qwen on Groq's free tier; presets for
     Z.AI GLM Flash, DeepSeek, OpenRouter, Ollama and custom endpoints. Replies are cleaned,
     coerced and validated, with one repair round;
   - `rulesBrief()` otherwise.
3. Never invent facts (phone numbers, emails, addresses, prices, dates, brand names) — leave them empty.
   Enforced in code: `guardFacts()` (`packages/ai/src/facts.ts`) strips every time, day, date, price,
   percentage, number and contact detail the prompt didn't state from model briefs, and corrects a
   part of day that contradicts the stated time. Keep its tests in `pnpm test:director` passing.
4. If the configured model is unavailable (rate limit, outage, timeout, unusable reply), fall back to
   `rulesBrief()` — a generation never fails just because the model did.
5. Follow the request: the brief's `requirements` lists every explicit instruction (imagery, style,
   colours, words, layout wishes) and each must be honoured; named colours go in `colors` and
   override the palette (`withBrandColor` primary + accent, contrast recomputed).
6. Test changes with `pnpm test:director`, `pnpm test:ideogram` and `pnpm test:design` (mock providers); try real keys
   with `pnpm director:try "<prompt>"`; price Ideogram with `pnpm ideogram:quote` (dry run).

## Design Principles (enforced by the engine)
- Colour: curated palettes with stated colour psychology; text must meet WCAG contrast
  (4.5:1 body, 3:1 display) — use `inkOn` / `mutedOn` / `softOn` / `readableOn`, never hard-code
  text colours or soften them with raw alpha. `pnpm audit:contrast` checks every layout × palette ×
  pairing × format and must pass after any engine or palette change.
- Type: pairings define display / emphasis / heading / body / label / script roles on a
  modular scale; measure text with `packages/design/src/metrics.ts` so nothing overflows.
- Layout: 19 archetypes in `packages/design/src/archetypes/`; use `stack()` so low-priority copy is
  dropped rather than overlapped; keep generous margins. Cap every fitted headline's height
  (`fitHeadline` maxHeight) so long copy can't push into the footer. An archetype declares
  `needsPhotos` / `needsContent`, `fits(copy)` when it needs something specific (a figure, a
  priced list, a timed programme — always as the user wrote it), and `maxDecor` when it must
  stay quiet. `layoutSuits()` (packages/design/src/compose.ts) is the one rule the chooser and the refine loop use.
  A new layout must pass `pnpm test:design` (lint-clean on short, event and rich copy in every
  format, with and without photos) and `pnpm audit:contrast`, and be reviewed rendered.
- Designer techniques (`packages/design/src/canvas/effects.ts`, `PhotoEffects`): photo effects (mono, duotone,
  blur, dim, grain), photo windows (`fitFrame`), outline text (`stroke` + fill "transparent"),
  blend modes and grain texture are drawn identically by Konva (editor), `packages/design/src/render/svg.ts`
  (critic, Illustrator) and the PSD export. Any new visual property must be added to all three
  and to `packages/design/src/canvas/schema.ts` — zod strips unknown keys, so a missed field is silently lost on save.
  Designer layouts set `maxDecor: "none"`; pick colours against what the text really sits on
  (textured paper, gradient tops, windows), not the nominal background.
- Fonts: the server renderer asks for each font by the family its file declares
  (`packages/design/src/render/font-families.json`, from `node packages/design/scripts/font-names.mjs`) — never assume the
  marketing name; `packages/design/assets/fonts/fallback-noto-*` covers ₦ and other extended-Latin characters.
- Decoration (the "spark"): the brief picks a decor level (minimal / balanced / bold) and up to
  three motifs from `packages/design/src/decor.ts`; `decorate()` places them only in the layout's free
  space, behind every text node, seeded so a brief always decorates the same way. Never draw
  decoration over type; each of the three directions leads with a different motif.

## Review → refine (Phase 1)
- Every generation is checked before it ships (`packages/ai/src/refine.ts`, stage `reviewing`):
  1. `lintDoc()` (`packages/design/src/lint.ts`) — cut-off or colliding type, tiny text, edge crowding,
     empty frames, weak hierarchy. A design with lint errors gets a layout swap, critic or not.
  2. The critic (`packages/ai/src/critic.ts`) renders the three directions server-side
     (`packages/design/src/render/` — resvg, the OFL fonts in `packages/design/assets/fonts`) on one wide contact sheet and a
     vision model scores each on a rubric and picks fixes from `FIXES`.
  3. Engine directions under 8.5 get their fixes applied; an Ideogram lead under 6 is replaced
     by an engine design (never a second paid image).
  4. Each revision is judged **side by side with its original** (`compare()`), never by a
     fresh absolute score — re-scores drift by more than a revision gains. A revision is kept
     only when the critic prefers it; its score moves by the difference seen in that comparison.
     The model isn't told which version is the revision.
  5. Strongest direction first.
- The critic uses `CRITIC_*` when set (its own per-minute budget), else the art director's
  models; `CRITIC=off` disables it. Any failure keeps the designs as they are — a review never
  fails a generation.
- Free tiers meter output per model per minute (Groq free: 1,000 tokens/min; a brief is
  ~650–700, a critique ~240, a comparison ~140). Ask for small `maxTokens`; `complete()` learns a
  provider's output cap from "request too large" and remembers it.
- Gates: `pnpm test:design` (lint, renderer, review loop on a mock vision model) and
  `pnpm benchmark` (100 prompts × every format, exit 1 on any lint error) run in CI. Run
  `pnpm benchmark --render` and look at `benchmark-report/` after any layout or engine change.

## Photos
- Stock photography from Unsplash (`packages/design/src/photos.ts`): hotlink, credit the photographer,
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
  credit prices in `packages/billing/src/plans.ts` are raised to match. A lead is one image ($0.03 low /
  $0.06 medium / $0.10 high, any size) + one Layerize call ($0.09) — check with
  `pnpm ideogram:quote` (dry run, free) before changing quality, sizes or credit prices.
- Ideogram 4.5 accepts only its own size presets (`IDEOGRAM_SIZES` in `packages/ai/src/ideogram.ts`);
  `ideogramSize()` picks the closest and the layers follow the artwork's cover crop.
- Store the brief and chosen variants on `generation_jobs.variations`; the first design becomes the project.
