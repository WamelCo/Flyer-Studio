# Architecture

```
apps/
  web/                      # Next.js 16 — UI only (no DB / storage SDKs)
    app/
      (marketing)/          # Landing, pricing, login — public
      (app)/                # Dashboard, editor, billing — auth required (proxy.ts + requireViewer)
      auth/signout/         # Form-post sign-out → Better Auth on the API
    components/             # ui/ (shadcn), canvas/ (Konva editor), billing/, create/, …
    lib/
      api/client.ts         # apiFetch() for the browser — same-origin /api/*
      api/server.ts         # serverApi() for Server Components — forwards cookies to the API
      auth/                 # Better Auth client, viewer lookup, login config
      storage.ts            # Presigned R2 uploads from the browser
  api/                      # Hono on Node — owns everything stateful
    src/
      app.ts                # Route table (all under /api), error handler
      auth.ts               # Better Auth (Prisma adapter, email OTP, Google)
      mail.ts               # Nodemailer SMTP (dev: codes print to the console)
      r2.ts                 # Cloudflare R2: presigned PUT/GET, HEAD, delete
      routes/               # projects, generate, export, uploads, billing, photos, webhooks, me, config
      stripe-webhook.ts     # Idempotent subscription → plan/credit sync
      jobs/retention.ts     # Daily Free-plan purge (30 days)
    scripts/                # stripe:setup, stripe:webhooks, test:stripe
packages/
  core/                     # Shared, framework-free TypeScript (no build step)
    src/design/             # Art director + layout engine
    src/canvas/             # FlyerDoc types, formats, zod schema
    src/stripe/plans.ts     # Plans, credit costs, Stripe price env mapping
    src/api/                # Contracts + error codes shared by API and web
  db/                       # Prisma 7 + PostgreSQL
    prisma/schema.prisma
    prisma/migrations/      # init (generated) + credit_functions (hand-written SQL)
    src/credits.ts          # deduct/add credits — the only way credits move
Dockerfile                  # targets: migrate, api, web (production)
docker-compose.yml          # postgres + migrate + api + web (production)
```

## Request flow

- **Browser → API**: `fetch("/api/…")` hits the Next server, which rewrites to `API_INTERNAL_URL`.
  Better Auth cookies are therefore first-party on the web origin; no CORS.
- **Server Component → API**: `serverApi("/api/…")` calls the API directly and forwards the
  visitor's `cookie` header.
- **Files**: the API returns a presigned R2 PUT URL (`POST /api/uploads`, `POST /api/export`);
  the browser uploads straight to R2. Exports are verified with a HEAD before download links
  (presigned GETs, 7 days) are issued.
- **Stripe** posts to `https://<site>/api/webhooks/stripe`, which the same rewrite delivers to the API.
