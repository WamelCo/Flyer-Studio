# Flyer Studio — AI Flyer Generator

Describe a flyer in a sentence, pick one of three generated designs, edit it on a Konva canvas, export PNG/PDF.
Project rules live in `CLAUDE.md` and `.claude/rules/`. Layout is described in `docs/ARCHITECTURE.md`.

## Local setup

1. Install dependencies: `pnpm install`
2. Start Supabase (needs Docker): `pnpm dlx supabase start` — migrations in `supabase/migrations` apply automatically.
3. Copy `.env.example` to `.env.local` and fill in the values printed by `pnpm dlx supabase status`.
   Art direction (optional; without it the built-in rules design simpler flyers):
   - free: `LLM_PROVIDER=groq` plus `LLM_API_KEY` from console.groq.com (Alibaba's open-weight Qwen), or
     `LLM_PROVIDER=zai` with a Z.AI key (Zhipu's GLM Flash). `deepseek`, `openrouter`, `ollama` and `custom`
     also work. Check it with `pnpm director:try "your prompt"`. Groq's free tier allows ~3 briefs a minute
     (8,000 tokens/min, 1,000 requests/day); set `LLM_FALLBACK_PROVIDER` + `LLM_FALLBACK_API_KEY` (e.g. `zai`)
     to absorb bursts. Every model brief passes a fact check (`lib/design/facts.ts`) that removes times,
     dates, prices and contacts the user didn't state;
   - or `ANTHROPIC_API_KEY` for Claude, which takes precedence.

   `UNSPLASH_ACCESS_KEY` (stock photos) is optional too: without it photo frames stay empty for you to fill.

   `IDEOGRAM_API_KEY` (optional, paid) makes the lead direction an Ideogram 4.5 design whose text is lifted
   into editable layers by Layerize. Create a key at ideogram.ai (API → accept the agreement, add a payment
   method, buy credits — requests return 402 until there are credits). `pnpm ideogram:quote` prices one
   design without charging; `IDEOGRAM_QUALITY` (low | medium | high) trades cost for detail.

   `NEXT_PUBLIC_SUPPORT_EMAIL` (optional) adds a contact address to the Privacy and Terms pages.
4. Stripe (test mode): put `STRIPE_SECRET_KEY` (sk_test_…) and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_…)
   in `.env.local`, then run `pnpm stripe:setup`. It creates the Pro and Max products, their monthly and annual
   prices and a Customer Portal configuration, and writes the IDs into `.env.local`. Re-running it is safe.
5. `pnpm dev`, and in a second terminal `pnpm stripe:webhooks` to deliver Stripe events to the dev server
   (no Stripe CLI needed). With the Stripe CLI installed, `stripe listen --forward-to localhost:3000/api/webhooks/stripe` works too.

## Verifying the money paths

- `pnpm test:db` — runs the real migration in an in-process Postgres (PGlite): signup → 0 credits, idempotent
  `add_credits` (an `invoice.paid` replay does not double-add), insufficient-credit rejection, parallel
  deductions never overdrawing, and that browser roles cannot call the credit RPCs.
- `node --env-file=.env.local scripts/test-credits-concurrency.mts` — the same guarantees under real
  concurrency, through PostgREST against a running Supabase.
- `pnpm test:stripe` — with `pnpm dev` running: a throwaway user subscribes with the test card, every Stripe
  event is delivered twice, credits must land exactly once, cancellation drops to Free; then it cleans up.
- `pnpm test:director` — the open-model art director against a mock provider (messy replies, repair round,
  strict-schema fallback, rate limits, refusals). `pnpm audit:contrast` — WCAG contrast across every design.
- Webhook replay: after a test checkout (card 4242 4242 4242 4242), `pnpm stripe:webhooks --replay --since=30 --once`
  delivers every recent event twice and fails unless each second delivery is ignored as a duplicate. Credit grants
  are also keyed `invoice:<id>` in the ledger, so checkout.session.completed and invoice.paid for the same payment
  grant once.

## Decisions worth knowing

| Topic | Choice |
| --- | --- |
| Credits | Only `deduct_credits` / `add_credits` (service role) move credits. Generate: 5 credits for 3 variations, refunded on failure. Export: 1–4 credits by format. Costs live in `lib/stripe/plans.ts`. |
| History | 100 undo steps (`.claude/rules/canvas-editor.md`). |
| Auto-save | 30s debounce, plus a keepalive flush on tab hide and a local draft so a hard refresh restores exact state. |
| Annual billing | 10× monthly; annual invoices grant 12 months of credits up front. |
| Exports | Rendered client-side by Konva at full resolution, charged server-side before upload to a signed slot. Free plan exports are watermarked. |
| Route protection | `proxy.ts` (Next 16's name for middleware). |
