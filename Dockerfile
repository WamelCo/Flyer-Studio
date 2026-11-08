# syntax=docker/dockerfile:1.7
#
# One Dockerfile, three runnable targets (built by docker-compose.yml):
#   migrate — applies Prisma migrations, then exits
#   api     — the Hono API (bundled by tsup)
#   web     — the Next.js app (standalone output)
# The workspace is installed and built once in `builder`; every target reuses it.

ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ── Dependencies (cached until a manifest or the lockfile changes) ───────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
# Inlined into the browser bundle / Next's route manifest at build time.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG R2_PUBLIC_URL
ARG API_INTERNAL_URL=http://api:4000
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    R2_PUBLIC_URL=$R2_PUBLIC_URL \
    API_INTERNAL_URL=$API_INTERNAL_URL
RUN mkdir -p apps/web/public \
 && pnpm turbo run build --filter=@flyer/api --filter=@flyer/web \
 && pnpm --filter @flyer/api deploy --prod --legacy /prod/api

# ── migrate ──────────────────────────────────────────────────────────────────
FROM builder AS migrate
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@flyer/db", "db:deploy"]

# ── api ──────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS api
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000
COPY --from=builder --chown=node:node /prod/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.js"]

# ── web ──────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
