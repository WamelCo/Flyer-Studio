# Deploying Flyer Studio

## Environments

Run two of everything so changes are proven before customers see them.

| | Staging | Production |
| --- | --- | --- |
| Supabase | its own project (free tier is fine) | its own project, Pro plan (point-in-time recovery) |
| Stripe | test mode keys | live mode keys (`pnpm stripe:setup` refuses live keys — create live prices in the dashboard) |
| AI keys | the same free Groq key is fine | a separate key, so limits don't collide — and a paid tier: Groq's free tier allows ~1 generation per minute site-wide (1,000 output tokens/min) |
| URL | e.g. `staging.flyerstudio.app` | your domain |

Copy `.env.example` into each environment's settings. `NEXT_PUBLIC_*` values are baked in at build time, so rebuild after changing them.

## Database migrations

Migrations live in `supabase/migrations/` and are applied in filename order. With the Supabase CLI linked to a project:

```bash
pnpm supabase db push
```

Without the CLI: open the project's **SQL Editor**, paste each new migration file and run it. Every migration is safe to re-run.

**Phase 0 (`20261107000000_phase0_jobs_rate_limits.sql`)** turns on background generation, rate limits and the stale-job sweeper. Until it's applied, the app still works: generation runs inside the request and rate limits are skipped (a `jobs.migration_missing` warning appears in the logs). After applying it, `pnpm test:generation` should report `mode: background`.

## Checks before every release

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request; run them locally with:

```bash
pnpm lint && pnpm typecheck && pnpm test:db && pnpm test:director && pnpm test:ideogram && pnpm test:jobs && pnpm audit:contrast && pnpm build && pnpm test:e2e
```

Against real services (staging): `pnpm test:generation` (art director + photos + database; add `--http` to go through a running dev server and `--sweeper` to watch the stale-job cron fire) and `pnpm test:stripe` (billing, with `pnpm dev` running).

## Hosting notes

- Generation runs after the response with Next.js `after()`; `app/api/generate/route.ts` sets `maxDuration = 120`. On Vercel that needs a plan whose function limit is at least 120 s (Hobby is 60 s). A job that dies is failed and refunded by the database sweeper within about 5 minutes.
- Security headers (CSP, HSTS, frame denial) come from `lib/security-headers.ts`. Adding a new third-party host? Add it there or the browser will block it.
- Sign-in emails: set Supabase → Authentication → SMTP to a transactional provider (Resend, Postmark) with your domain's SPF and DKIM, so codes don't land in spam.

## Monitoring

- **Sentry:** set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`; add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` for readable stack traces. Failed generations are reported with their job ID.
- **PostHog:** set `NEXT_PUBLIC_POSTHOG_KEY`. Events are cookieless: page views, `generation_started`, `generation_succeeded` (with time and lead source), `generation_failed`. The Privacy page lists PostHog automatically when the key is set.
- **Logs:** one JSON object per line (`lib/log.ts`): filter by `event` (`generation.succeeded`, `generation.failed`, `rate_limit.blocked`, `ideogram.daily_cap_reached`) and `jobId`.
