# CLAUDE.md — AI Flyer Generator

> This file is loaded on every turn. Keep it under 200 lines.
> Specialized rules live in `.claude/rules/*.md` and are loaded on demand.

---

## 1. Project Context

A production SaaS that generates flyers from a text prompt, lets users edit them on a canvas, and exports for print or social. Quality bar is Apple-level: clarity, deference, depth, consistency.

**Monorepo (Turborepo + pnpm workspaces):**
- `apps/web` — Next.js 16 (App Router) UI. Never touches the database or storage SDKs: Server Components call the API with `serverApi()` (`lib/api/server.ts`, forwards cookies); the browser calls `/api/*`, which `next.config.ts` rewrites to the API.
- `apps/api` — Hono on Node. Owns the database, auth, R2, Stripe and generation. Every route lives under `/api`.
- `packages/core` — framework-free shared code: design engine (`src/design`), canvas schema/types, plans (`src/stripe/plans.ts`), API contracts. TypeScript source, consumed directly (no build step).
- `packages/db` — Prisma schema, migrations and client (`@flyer/db`), plus the credit wrappers.

**Stack (mandatory, do not substitute):**
- TypeScript strict mode everywhere
- Next.js 16 + Tailwind CSS + shadcn/ui (web)
- Hono (API)
- PostgreSQL + Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg`)
- Better Auth (passwordless email code via Nodemailer/SMTP, optional Google) — server in `apps/api/src/auth.ts`, client in `apps/web/lib/auth/client.ts`
- Cloudflare R2 for all files (S3 API, presigned PUT/GET) — `apps/api/src/r2.ts`. Public bucket for uploads/thumbnails, private bucket for exports.
- Stripe (Subscriptions + Embedded Checkout + Webhooks)
- A text LLM as art director + a layout engine (`packages/core/src/design/`) that designs every flyer. Claude (`@anthropic-ai/sdk`) when `ANTHROPIC_API_KEY` is set; otherwise an open-weight model (Qwen / GLM / DeepSeek) over an OpenAI-compatible API (`open-model.ts`)
- Ideogram 4.5 as an optional **renderer** (`IDEOGRAM_API_KEY`): it finishes the engine's layout from a compiled structured prompt (`render-prompt.ts`); it never designs. Principles live in `design/principles.ts`
- Unsplash (stock photography for photo frames)
- Konva (`react-konva`) for the canvas editor
- Framer Motion for ALL UI animation

**Never** reintroduce Supabase or another BaaS. Configuration is one root `.env` (see `.env.example`).
`docker-compose.yml` + `Dockerfile` are for **production deployment only**; local development runs on the host.

---

## 2. Commands

```bash
pnpm dev                         # API (:4000) + web (:3000) via turbo
pnpm build                       # Production build — must pass before any phase is "done"
pnpm lint                        # ESLint — must pass before any phase is "done"
pnpm typecheck                   # tsc --noEmit in every package
pnpm db:migrate                  # prisma migrate dev (create/apply migrations locally)
pnpm db:deploy                   # prisma migrate deploy
pnpm db:generate                 # regenerate the Prisma client
pnpm db:studio                   # Prisma Studio
pnpm test:db                     # Credit SQL functions in PGlite (no server needed)
pnpm test:db:concurrency         # Same, under real concurrency against DATABASE_URL
pnpm stripe:setup                # Test mode: create products/prices/portal config, write IDs to .env
pnpm stripe:webhooks [--replay]  # Forward test events to the local API without the Stripe CLI
pnpm test:stripe                 # Billing end to end in test mode (needs pnpm dev running)
pnpm test:director               # Art director against a mock OpenAI-compatible provider
pnpm director:try "<prompt>"     # Try the configured art director on a real prompt
pnpm audit:contrast              # WCAG contrast across every layout × palette × pairing × format
pnpm test:render                 # Render-prompt compiler rules, offline (no API calls)
pnpm render:try -- --fixture health [--dry]   # Render a fixture through Ideogram (costs ~$0.10)
```

---

## 3. Rules of the road

- Credits move ONLY through the `deduct_credits` / `add_credits` SQL functions (`packages/db/src/credits.ts`).
  They live in the `credit_functions` migration together with the check constraints Prisma can't model.
- New API response shapes go in `packages/core/src/api/contracts.ts`; error codes in `api/types.ts`.
- Schema changes: edit `packages/db/prisma/schema.prisma`, then `pnpm db:migrate --name <change>`.
  Never hand-edit an applied migration.
- Files never pass through the API: it issues presigned R2 URLs and the browser uploads directly.
