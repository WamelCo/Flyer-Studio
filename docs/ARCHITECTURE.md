# Architecture

A Turborepo monorepo (pnpm workspaces). Apps are things that run; packages are shared code
that ships as TypeScript source. A package never imports from an app.

```
apps/
  web/                    Next.js 16 — the studio on the web
    app/(marketing)/      Landing, pricing, sign-in (email or WhatsApp code), legal
    app/(app)/            Dashboard, projects, editor, billing, WhatsApp linking — signed in
    app/api/auth/         Better Auth (codes, sessions, sign-out)
    app/api/generate/     Starts a generation job (charges credits), polled by the client
    app/api/export/       Charges, receives the rendered file (→ R2, private), signs download links
    app/api/uploads/      Images for the canvas (→ R2, public), checked by their bytes
    app/api/checkout/     Paynow passes: start, status (polls Paynow)
    app/api/webhooks/     Paynow result URL — hash-verified, idempotent
    instrumentation.ts    Starts the scheduled database upkeep
    proxy.ts              Sign-in redirect for app routes + the Content-Security-Policy
  whatsapp/               Hono + whatsapp-web.js
    src/bot.ts            The conversation: link check, trial, credits, flyers, "1/2/3", passes
    src/whatsapp.ts       The studio's WhatsApp Web session (QR login, LID → phone)
    src/server.ts         /internal/send (sign-in codes from the web app), /internal/status, /qr, /health
packages/
  ai/                     Prompt cleaning, brief, art director (Claude / open models), fact guard,
                          critic + refine loop, Ideogram + Layerize, pipeline, job runner
  design/                 Layout engine (archetypes, palettes, type, decor, lint), canvas model and
                          zod schema, server renderer (resvg) + fonts, Unsplash photos
  db/                     Drizzle schema, SQL migrations (drizzle/), credits, rate limits, upkeep
  auth/                   Better Auth: email codes (Resend), WhatsApp codes (via apps/whatsapp)
  storage/                Cloudflare R2 / any S3 API (aws4fetch): put, head, delete, signed links
  billing/                Plans and prices, Paynow client (hash, initiate, poll), passes
  log/                    One JSON object per log line
  tsconfig/               Shared compiler settings
Dockerfile, docker/       One container: web + WhatsApp + Postgres (docker/start.mjs supervises)
```

## Data and trust

- **Postgres** is plain Postgres. Credits move only through SQL functions (`deduct_credits`,
  `add_credits`, `fulfil_payment`) that are idempotent on their keys and lock the profile row.
  Authorization is in application code: every query is scoped to the signed-in user.
- **Sessions** are Better Auth cookies, verified on every page and API route (the proxy only
  does a cookie-presence redirect). A new user row gets a Free profile from a database trigger.
- **WhatsApp** messages are trusted only from numbers verified on the web (a WhatsApp code).
  The web app and the WhatsApp service share `INTERNAL_API_SECRET`; inside the container the
  service listens on 127.0.0.1.
- **Files**: uploads and exports pass through the app (size and type checked by bytes), then go
  to R2. Public art is served from the R2 custom domain with CORS; exports only by signed link.
