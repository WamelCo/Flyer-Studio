# syntax=docker/dockerfile:1
# Flyer Studio in one container: the web app (Next.js), the WhatsApp service (Hono +
# whatsapp-web.js) and — unless DATABASE_URL points elsewhere — Postgres, started together
# by docker/start.mjs. Build from the repository root:  docker compose build

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 PUPPETEER_SKIP_DOWNLOAD=1
RUN corepack enable

# Only the workspaces the image needs; package.json files split out so the install layer
# is cached until dependencies change (turbo prune --docker).
FROM base AS prune
WORKDIR /repo
COPY . .
RUN npx --yes turbo@2.11.10 prune @flyer/web @flyer/whatsapp --docker

FROM base AS build
WORKDIR /repo
# Next.js bakes NEXT_PUBLIC_* values into the build (docker-compose.yml passes them from .env).
ARG NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_SUPPORT_EMAIL NEXT_PUBLIC_POSTHOG_KEY NEXT_PUBLIC_POSTHOG_HOST NEXT_PUBLIC_SENTRY_DSN NEXT_PUBLIC_SENTRY_ENVIRONMENT NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=$NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm --filter @flyer/db build \
 && pnpm --filter @flyer/whatsapp build \
 && pnpm --filter @flyer/web build
# The WhatsApp bundle keeps whatsapp-web.js and resvg in node_modules (production deps only).
RUN pnpm --filter @flyer/whatsapp deploy --prod --legacy /out/whatsapp

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql chromium tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1001 flyer \
 && mkdir -p /data \
 && chown flyer:flyer /data
WORKDIR /app
COPY --from=build --chown=flyer:flyer /repo/apps/web/.next/standalone ./web
COPY --from=build --chown=flyer:flyer /repo/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build --chown=flyer:flyer /out/whatsapp/node_modules ./whatsapp/node_modules
COPY --from=build --chown=flyer:flyer /repo/apps/whatsapp/dist ./whatsapp/dist
COPY --from=build --chown=flyer:flyer /repo/packages/db/dist/migrate.cjs ./db/migrate.cjs
COPY --from=build --chown=flyer:flyer /repo/packages/db/drizzle ./db/drizzle
COPY --from=build --chown=flyer:flyer /repo/packages/design/assets/fonts ./fonts
COPY --chown=flyer:flyer docker/start.mjs ./start.mjs

ENV NODE_ENV=production \
    DATA_DIR=/data \
    FLYER_FONTS_DIR=/app/fonts \
    MIGRATIONS_DIR=/app/db/drizzle \
    WHATSAPP_DATA_DIR=/data/whatsapp \
    CHROME_PATH=/usr/bin/chromium \
    PG_BIN=/usr/lib/postgresql/15/bin
USER flyer
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/start.mjs"]
