# Deploying Flyer Studio

Flyer Studio runs as **one container**: the web app, the WhatsApp service and Postgres,
started and stopped together by `docker/start.mjs`. Any Linux server with Docker works
(2 vCPU / 4 GB RAM is comfortable — WhatsApp Web runs a headless Chromium).

## First deploy

```bash
git clone … && cd flyer-studio
cp .env.example .env        # then fill it in (below)
docker compose up -d --build
docker compose logs -f      # the first time: scan the WhatsApp QR code printed here
```

In `.env`, at minimum:

| Setting | Notes |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | The public https URL. Baked into the build: rebuild after changing it. |
| `STORAGE_*` | Cloudflare R2: two buckets (`flyers` public via a custom domain, `exports` private), an API token with Object Read & Write. Run `pnpm storage:setup` once (from any machine with the same values) to create missing buckets and the CORS rule the editor needs. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email sign-in codes. Verify your domain in Resend (SPF, DKIM) so codes don't land in spam. |
| `PAYNOW_*` | Paynow integration ID and key; `PAYNOW_TEST_AUTH_EMAIL` while it is in test mode. |
| AI keys | `LLM_PROVIDER` + `LLM_API_KEY` (or `ANTHROPIC_API_KEY`), `UNSPLASH_ACCESS_KEY`, optionally `IDEOGRAM_API_KEY`. |
| `WHATSAPP_ADMIN_TOKEN` | Protects the QR page `http://localhost:3001/qr?token=…` (on the server only). |

Leave `DATABASE_URL`, `BETTER_AUTH_SECRET` and `INTERNAL_API_SECRET` empty: the container runs
Postgres itself and generates the secrets once, keeping them in the `flyer-data` volume. Set
`DATABASE_URL` to use a managed Postgres instead (the embedded one is then not started).

**HTTPS:** the container serves plain HTTP on port 3000. Put it behind Cloudflare (proxied DNS
or a Cloudflare Tunnel — you already use Cloudflare for R2) or a reverse proxy such as Caddy.

**WhatsApp:** use a number dedicated to the studio. whatsapp-web.js drives WhatsApp Web and is
not an official API: WhatsApp can restrict a number it considers automated, so don't use a
personal number and keep message volumes human. The session survives restarts (it lives in
`/data/whatsapp`); if the phone logs the device out, a new QR code appears in the logs.

## Updating

```bash
git pull && docker compose up -d --build
```

Migrations (`packages/db/drizzle`) run automatically before the apps start; a failed migration
stops the container rather than starting on a half-migrated database.

## Backups

Everything stateful is in the `flyer-data` volume: Postgres (`/data/postgres`), the WhatsApp
session and the generated secrets. Back up the database with:

```bash
docker compose exec flyer pg_dump -h 127.0.0.1 -U flyer flyer > flyer-$(date +%F).sql
```

R2 holds the files; enable R2's object versioning or bucket replication if you need it.

## Environments

Run a staging copy (its own server or a second compose project, its own R2 buckets, a Paynow
integration in test mode) and prove changes there before production.

## Checks before every release

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request, plus a build of
the container image:

```bash
pnpm lint && pnpm typecheck && pnpm test:db && pnpm test:whatsapp && pnpm test:director && pnpm test:ideogram && pnpm test:jobs && pnpm audit:contrast && pnpm build && pnpm test:e2e
```

Against real services (staging): `pnpm test:generation` (art director + photos + database; add
`--http` to go through a running server and `--sweeper` to run the stale-job sweep). Payments: a
real test-mode Paynow payment through the billing page and through WhatsApp ("buy").

## Hosting notes

- Generation runs after the response (`after()` on the web, in-process on WhatsApp). A job that
  dies is failed and refunded by the scheduled sweep within about 5 minutes.
- Scheduled upkeep (stale jobs, lapsed passes, Free-plan retention, expired sessions) runs inside
  the web app every minute/hour/day (`packages/db/src/maintenance.ts`); `MAINTENANCE=off` disables it.
- Security headers: static ones in `apps/web/next.config.ts`; the CSP is set per request in
  `apps/web/proxy.ts` from `apps/web/lib/security-headers.ts`, so the storage origin can change
  without a rebuild. Adding a third-party host? Add it there.

## Monitoring

- **Health:** `GET /api/health` (used by the container healthcheck) checks the database.
- **Sentry:** set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`; add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` for readable stack traces.
- **PostHog:** set `NEXT_PUBLIC_POSTHOG_KEY`. Cookieless events: page views and generation outcomes.
- **Logs:** `docker compose logs -f` — one JSON object per line (`packages/log`): filter by `event`
  (`generation.failed`, `whatsapp.message_failed`, `rate_limit.blocked`, `ideogram.daily_cap_reached`, `maintenance.ran`) and `jobId`.
