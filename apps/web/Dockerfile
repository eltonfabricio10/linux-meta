# linux-meta web — Astro SSR (node standalone adapter).
# Single-stage on purpose: pnpm's symlinked workspace store is awkward to copy
# across stages, and disk (42G) is cheaper than debugging that on a 1G box.
FROM node:22-slim

RUN corepack enable
WORKDIR /repo

# Skip Playwright browser download (e2e is not built here anyway).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# PUBLIC_* are inlined by Astro at BUILD time (astro.config `site`, client bundle),
# so they must be present now. Secrets below are placeholders only to survive
# module evaluation during build; real values arrive at runtime via env_file and
# override these because code reads process.env (never import.meta.env) for them.
ARG PUBLIC_SITE_URL=http://163.176.62.227
ARG PUBLIC_DEFAULT_LOCALE=pt
ARG DATABASE_URL=postgres://build:build@localhost:5432/build
ARG BETTER_AUTH_SECRET=build-time-placeholder-secret-min-32-chars
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL \
    PUBLIC_DEFAULT_LOCALE=$PUBLIC_DEFAULT_LOCALE \
    DATABASE_URL=$DATABASE_URL \
    BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET

COPY . .

# Install only the web app and its workspace deps (skips workers/e2e/playwright).
RUN pnpm install --frozen-lockfile --filter @linux-meta/web... \
 && pnpm --filter @linux-meta/web build \
 && pnpm store prune

WORKDIR /repo/apps/web
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4400
EXPOSE 4400
CMD ["node", "./dist/server/entry.mjs"]
