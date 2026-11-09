# CLAUDE.md — AI Flyer Generator

> This file is loaded on every turn. Keep it under 200 lines.
> Specialized rules live in `.claude/rules/*.md` and are loaded on demand.

---

## 1. Project Context

A production SaaS that generates flyers from a text prompt — on the web or over WhatsApp — lets users edit them on a canvas, and exports for print or social. Quality bar is Apple-level: clarity, deference, depth, consistency.

**Stack (mandatory, do not substitute):**
- Turborepo + pnpm workspaces (`apps/*`, `packages/*`); TypeScript strict mode everywhere
- Next.js 16 (App Router) — `apps/web`; Tailwind CSS + shadcn/ui
- Postgres + Drizzle ORM — `packages/db` (schema, SQL migrations, credit functions). No vendor-specific database features.
- Better Auth — `packages/auth`: sign-in codes by email (Resend) and by WhatsApp
- Cloudflare R2 over the S3 API (any S3-compatible store works) — `packages/storage`
- Paynow Zimbabwe (USD prepaid passes: hosted checkout + signed result URL + status polling) — `packages/billing`
- WhatsApp: Hono + whatsapp-web.js — `apps/whatsapp`
- A text LLM as art director: Claude (`@anthropic-ai/sdk`) when `ANTHROPIC_API_KEY` is set; otherwise an open-weight model (Qwen / GLM / DeepSeek) over an OpenAI-compatible API (`packages/ai/src/open-model.ts`)
- Ideogram 4.5 (lead design) + Layerize (text → editable layers) — `packages/ai/src/ideogram.ts`; a layout engine (`packages/design`) for the other directions. Output is always editable layers, never a flat image.
- Unsplash (stock photography for photo frames)
- Konva (`react-konva`) for the canvas editor
- Framer Motion for ALL UI animation
- Deployment: ONE container (`Dockerfile`, `docker-compose.yml`) running the web app, the WhatsApp service and an embedded Postgres (or an external one via `DATABASE_URL`)

**Layout:**
| Path | What |
| --- | --- |
| `apps/web` | Next.js app: UI, API routes, Better Auth routes, Paynow return/result URLs, scheduled DB upkeep (`instrumentation.ts`) |
| `apps/whatsapp` | WhatsApp service: the bot (`src/bot.ts`), whatsapp-web.js session, internal API (sign-in codes) |
| `packages/ai` | Everything AI: prompt cleaning, brief, art director, fact guard, critic + refine loop, Ideogram, the generation pipeline and job runner |
| `packages/design` | Layout engine (archetypes, palettes, type, decor, lint), canvas model + zod schema, server renderer (resvg) and fonts |
| `packages/db` | Drizzle schema, migrations (`drizzle/`), credits, rate limits, upkeep tasks |
| `packages/auth` · `storage` · `billing` · `log` | Better Auth config + accounts by phone (`accounts.ts`) · R2/S3 · Paynow + plans · structured logs |

Workspace packages ship TypeScript source (`exports` → `src/*.ts`); import them as `@flyer/<name>/<module>`. A package never imports from an app.

**Roadmap:** `docs/ROADMAP.md` (phases 0–6; Phase 0 built). Deploying: `docs/DEPLOYMENT.md`. Approved additions, adopted with their phase — not
substitutes for the stack above: Inngest (background jobs), Sentry, PostHog, Resend (email), resvg (server rendering), WorkOS (SSO/SCIM), Gelato (print orders).

---

## 2. Commands

Run from the repo root; configuration comes from the root `.env.local`.

```bash
pnpm dev                         # Web app on :3000 (pnpm dev:whatsapp: the WhatsApp service on :3001; pnpm dev:all: both)
pnpm build                       # Production builds — must pass before any phase is "done"
pnpm lint                        # ESLint — must pass before any phase is "done"
pnpm typecheck                   # tsc in every app and package
pnpm db:generate                 # Write the next migration after editing packages/db/src/schema.ts
pnpm db:migrate                  # Apply migrations to DATABASE_URL
pnpm storage:setup               # Create the R2/S3 buckets and the public bucket's CORS rule
pnpm admin:grant-pass <phone|email> <pro|max> [month|year]  # Give an account a pass without a payment
pnpm test:db                     # Migrations, credit ledger, passes, upkeep, WhatsApp trials — PGlite
pnpm test:whatsapp               # The WhatsApp bot (PGlite + a fake channel) and its internal API
pnpm test:storage                # Storage helpers; with STORAGE_* set, a live R2/S3 round trip
pnpm test:paynow                 # Paynow: hash vs Paynow's documented examples, client vs a mock Paynow
pnpm test:director               # Art director against a mock OpenAI-compatible provider
pnpm director:try "<prompt>"     # Try the configured art director on a real prompt
pnpm test:ideogram               # Ideogram lead direction against a mock API (no credits)
pnpm ideogram:quote              # Exact Ideogram price per lead design (dry run, no charge)
pnpm audit:contrast              # WCAG contrast across every layout × palette × pairing × format
pnpm test:jobs                   # Background generation client (polling, failures, timeouts)
pnpm test:e2e                    # Playwright smoke tests against a production build (pnpm build first)
pnpm test:generation [--http] [--sweeper]  # Real pipeline end to end (throwaway user); --http needs pnpm dev
pnpm test:design                 # Design lint, server renderer, critique → compare loop (mock vision model)
pnpm benchmark [--render] [--live --limit N]  # 100-prompt design benchmark; fails on any lint error
pnpm test:export                 # Photoshop (PSD) and Illustrator (SVG) exports: layers, live text, fonts
docker compose up -d --build     # The whole studio in one container (see docs/DEPLOYMENT.md)
```
