# Flyer Studio — AI Flyer Generator

Describe a flyer in a sentence — on the web or in a WhatsApp message — pick one of three generated designs, edit
it on a Konva canvas, export PNG/PDF/Photoshop/Illustrator. A Turborepo monorepo: `apps/web` (Next.js),
`apps/whatsapp` (Hono + whatsapp-web.js) and shared packages (`ai`, `design`, `db`, `auth`, `storage`, `billing`).
Project rules live in `CLAUDE.md` and `.claude/rules/`. Layout is described in `docs/ARCHITECTURE.md`; deploying
(one Docker container) in `docs/DEPLOYMENT.md`.

## Local setup

1. `pnpm install`
2. Postgres: `docker run -d --name flyer-pg -p 5432:5432 -e POSTGRES_PASSWORD=flyer postgres:17` (or any Postgres).
3. Copy `.env.example` to `.env.local` at the repo root and fill it in — every app and script reads it:
   - `DATABASE_URL` (matches step 2 by default) and `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
   - Email codes: `SMTP_*` (e.g. Gmail with an app password, no domain needed) or `RESEND_API_KEY` + `EMAIL_FROM`.
     Without either, in development the code is printed in the terminal running `pnpm dev`.
   - Files: `STORAGE_*` for a Cloudflare R2 bucket pair, then `pnpm storage:setup`. Offline, any S3-compatible
     server works, e.g. `docker run -d -p 9100:9000 -e RUSTFS_ACCESS_KEY=dev -e RUSTFS_SECRET_KEY=dev-secret-123 rustfs/rustfs`
     with `STORAGE_ENDPOINT=http://127.0.0.1:9100`, `STORAGE_REGION=us-east-1`, `STORAGE_PUBLIC_URL=http://127.0.0.1:9100/flyers`.
     Without storage, generation works but uploads, exports and Ideogram artwork don't.
   - Art direction (optional; without it the built-in rules design simpler flyers): `LLM_PROVIDER=groq` plus
     `LLM_API_KEY` from console.groq.com (Qwen), or `zai`, `deepseek`, `openrouter`, `ollama`, `custom`; or
     `ANTHROPIC_API_KEY` for Claude, which takes precedence. Check it with `pnpm director:try "your prompt"`.
     Every model brief passes a fact check (`packages/ai/src/facts.ts`).
   - `UNSPLASH_ACCESS_KEY` (stock photos) and `IDEOGRAM_API_KEY` (paid lead design; `pnpm ideogram:quote`
     prices one without charging) are optional.
4. `pnpm db:migrate`, then `pnpm dev` → http://localhost:3000.
5. WhatsApp (optional): set `INTERNAL_API_SECRET` (any long random string) and `CHROME_PATH` (your Chrome),
   then `pnpm dev:whatsapp` and scan the QR code it prints with the studio's WhatsApp (Linked devices). Use a
   number dedicated to the studio. Sign in on the web with "WhatsApp" to link your own number, then message
   the studio number.
6. Paynow (Zimbabwe): Receive Payments → Integrations → create one, then `PAYNOW_INTEGRATION_ID` and
   `PAYNOW_INTEGRATION_KEY`. New integrations start in test mode: set `PAYNOW_TEST_AUTH_EMAIL` to the merchant
   account's email and pay with "[TESTING: Faked Success]" (or the test wallet 0771111111). Paynow can't reach
   localhost, so in development the billing page's status check completes the payment.

## Verifying the money paths

- `pnpm test:db` — the real migrations in an in-process Postgres (PGlite): signup → Free profile with 0 credits,
  idempotent `add_credits` / `deduct_credits`, insufficient-credit results, parallel deductions never
  overdrawing, passes (credits once per payment, renewals extending, lapsed passes returning to Free), the
  scheduled upkeep, one WhatsApp trial per number and account, and deleting a user removing everything they own.
- `pnpm --filter @flyer/db exec tsx scripts/test-credits-concurrency.mts` — the same guarantees under real
  concurrency (20 connections) against `DATABASE_URL`.
- `pnpm test:whatsapp` — the bot end to end with a fake WhatsApp: linking, the free trial, charging, watermarks,
  refunds, "2" opening a design, passes, rate limits, and the internal API's secret.
- `pnpm test:paynow` — the Paynow hash against Paynow's own documented examples, and the client against a mock
  Paynow (field order, signed replies, tampering refused, test-mode email, poll-host guard).
- `pnpm test:director`, `pnpm test:ideogram`, `pnpm test:design`, `pnpm benchmark`, `pnpm audit:contrast` — the
  AI and the design engine against mock providers; WCAG contrast across every design.
- Replays: a payment's credits are keyed `paynow:<payment id>` in the ledger and `fulfil_payment` is a no-op for a
  paid payment, so repeated result-URL posts and status polls grant once.

## Decisions worth knowing

| Topic | Choice |
| --- | --- |
| Credits | Only the SQL functions `deduct_credits` / `add_credits` / `fulfil_payment` move credits. Generate: 5 credits for 3 variations, refunded on failure. Export: 1–4 credits by format. Costs live in `packages/billing/src/plans.ts`. |
| Accounts | WhatsApp-first: a number's first message creates its account (the number is the key) with 3 free flyers. On the web, a WhatsApp-code sign-in opens that same account; an email account that links the number absorbs it. |
| Sign-in | Better Auth, passwordless: a 6-digit code by WhatsApp (default) or email. |
| Free flyers | 3 per number, once ever; watermarked, never a paid Ideogram image; on WhatsApp or the web. |
| History | 100 undo steps (`.claude/rules/canvas-editor.md`). |
| Auto-save | 30s debounce, plus a keepalive flush on tab hide and a local draft so a hard refresh restores exact state. |
| Annual billing | 10× monthly; an annual pass grants 12 months of credits up front. |
| Exports | Rendered client-side by Konva at full resolution, charged server-side, uploaded through the app to private storage, downloaded by signed link. Free plan exports are watermarked. |
| Deployment | One container: web + WhatsApp + Postgres (`Dockerfile`, `docker-compose.yml`). |
