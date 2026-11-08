# Flyer Studio — AI Flyer Generator

Describe a flyer in a sentence, pick one of three generated designs, edit it on a Konva canvas, export PNG/PDF.
Project rules live in `CLAUDE.md` and `.claude/rules/`. Layout is described in `docs/ARCHITECTURE.md`.

Turborepo with `apps/web` (Next.js), `apps/api` (Hono), `packages/core` (shared design engine + contracts)
and `packages/db` (Prisma + PostgreSQL). Auth is Better Auth, files live in Cloudflare R2.

## Local setup

Needs Node 22.12+, pnpm 10, and a PostgreSQL database you can reach (a local install, or a free hosted
one such as Neon). Docker is **not** needed for development.

1. `pnpm install`
2. Copy `.env.example` to `.env` (repo root) and fill in at least:
   - `DATABASE_URL`
   - `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
   - the `R2_*` values (see **Cloudflare R2** below)

   Without `SMTP_HOST`, sign-in codes are printed in the API's console — handy for development.
3. Apply the database schema: `pnpm db:deploy` (or `pnpm db:migrate` when you're changing the schema).
4. `pnpm dev` — API on http://localhost:4000, web on http://localhost:3000.

Optional:
- **Google sign-in**: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, redirect URI `http://localhost:3000/api/auth/callback/google`.
- **Art direction** (without it the built-in rules design simpler flyers):
  free: `LLM_PROVIDER=groq` plus `LLM_API_KEY` from console.groq.com (Alibaba's open-weight Qwen), or
  `LLM_PROVIDER=zai` with a Z.AI key (Zhipu's GLM Flash). `deepseek`, `openrouter`, `ollama` and `custom`
  also work. Check it with `pnpm director:try "your prompt"`. Set `LLM_FALLBACK_PROVIDER` + `LLM_FALLBACK_API_KEY`
  to absorb rate limits. Every model brief passes a fact check (`packages/core/src/design/facts.ts`).
  Or `ANTHROPIC_API_KEY` for Claude, which takes precedence.
- **Stock photos**: `UNSPLASH_ACCESS_KEY`. Without it photo frames stay empty for you to fill.
- **Renderer**: `IDEOGRAM_API_KEY`. The engine still designs every flyer (grid, spacing, hierarchy, palette,
  type, contrast); Ideogram 4.5 then renders that exact layout as a finished graphic from a compiled structured
  prompt — see `packages/core/src/design/render-prompt.ts` and `principles.ts`. Each variant falls back to its
  editable engine design if rendering fails. Generation returns the three editable designs quickly; only the
  design the user picks is rendered (~$0.10 at high quality, `IDEOGRAM_QUALITY=medium` for ~$0.06). The first
  render of a generation is included in its credits; rendering another design from it costs
  `CREDIT_COSTS.render`. Try it with `pnpm render:try -- --fixture health`.
- **Stripe (test mode)**: put `STRIPE_SECRET_KEY` (sk_test_…) and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_…)
  in `.env`, then run `pnpm stripe:setup`. It creates the Pro and Max products, prices and a Customer Portal
  configuration and writes the IDs into `.env`. Then, next to `pnpm dev`, run `pnpm stripe:webhooks` to deliver
  Stripe events to the local API (no Stripe CLI needed), or `stripe listen --forward-to localhost:4000/api/webhooks/stripe`.

## Cloudflare R2

Create two buckets:

| Bucket | Access | Holds |
| --- | --- | --- |
| `R2_BUCKET_PUBLIC` | Public (r2.dev subdomain or custom domain → `R2_PUBLIC_URL`) | uploaded images, thumbnails |
| `R2_BUCKET_EXPORTS` | Private | finished PNG/PDF exports (presigned links) |

Create an R2 API token with Object Read & Write on both and put its keys in `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY`, plus your `R2_ACCOUNT_ID`.

The browser uploads directly to R2 with presigned URLs and Konva loads images cross-origin, so **both buckets
need a CORS policy** (Bucket → Settings → CORS policy). List every origin you use:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://your-domain.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

## Production (Docker Compose)

`docker-compose.yml` runs every service: PostgreSQL, a one-shot `migrate` job, the API and the web app.

```bash
cp .env.example .env     # production values: NEXT_PUBLIC_SITE_URL=https://your-domain, POSTGRES_PASSWORD, …
docker compose up -d --build
```

- Only `web` is published (port `WEB_PORT`, default 3000). Put a TLS reverse proxy in front of it.
  The API and Postgres stay on the compose network; the browser reaches the API through web's `/api` rewrite.
- `NEXT_PUBLIC_*` and `R2_PUBLIC_URL` are baked in at build time — rebuild after changing them.
- Stripe webhook endpoint: `https://your-domain/api/webhooks/stripe`. Google redirect URI:
  `https://your-domain/api/auth/callback/google`.
- Production requires SMTP (`SMTP_HOST` …) for sign-in codes.

## Verifying the money paths

- `pnpm test:db` — runs every migration in an in-process Postgres (PGlite): new profile → 0 credits,
  idempotent `add_credits` (an `invoice.paid` replay does not double-add), insufficient-credit rejection,
  interleaved deductions never overdrawing, the non-negative constraint, and the Free-plan retention purge.
- `pnpm test:db:concurrency` — the same guarantees under real concurrency against `DATABASE_URL`.
- `pnpm test:stripe` — with `pnpm dev` running: a throwaway user subscribes with the test card, every Stripe
  event is delivered twice, credits must land exactly once, cancellation drops to Free; then it cleans up.
- `pnpm test:director` — the open-model art director against a mock provider. `pnpm audit:contrast` — WCAG
  contrast across every design.
- Webhook replay: after a test checkout (card 4242 4242 4242 4242), `pnpm stripe:webhooks --replay --since=30 --once`
  delivers every recent event twice and fails unless each second delivery is ignored as a duplicate.

## Decisions worth knowing

| Topic | Choice |
| --- | --- |
| Boundaries | Only the API touches Postgres, R2 and Stripe secrets. The web app talks to it over HTTP. |
| Credits | Only the `deduct_credits` / `add_credits` SQL functions move credits (`packages/db/src/credits.ts`). Generate: 5 credits for 3 variations, refunded on failure. Export: 1–4 credits by format. Costs live in `packages/core/src/stripe/plans.ts`. |
| Auth | Better Auth: emailed one-time code (Nodemailer/SMTP) or Google. Every new user gets a Free profile from a database hook. |
| Files | Presigned R2 PUTs with signed Content-Type/Length; the API picks every object key. |
| History | 20 undo steps (`.claude/rules/canvas-editor.md` overrides the brief's 50). |
| Auto-save | 30s debounce, plus a keepalive flush on tab hide and a local draft so a hard refresh restores exact state. |
| Annual billing | 10× monthly; annual invoices grant 12 months of credits up front. |
| Exports | Rendered client-side by Konva at full resolution, charged server-side before upload to a presigned slot. Free plan exports are watermarked. |
| Retention | Free-plan projects untouched for 30 days are purged daily by the API (`RETENTION_JOB=off` disables). |
| Route protection | `apps/web/proxy.ts` (Next 16's name for middleware) checks for a session cookie; pages verify it with the API. |
