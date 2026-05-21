# Selfbase web — production build served by a tiny caddy/static server.
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages ./packages/
RUN pnpm install --frozen-lockfile=false --filter @selfbase/web...

FROM deps AS builder
COPY apps/web ./apps/web
COPY packages ./packages
WORKDIR /app/apps/web
RUN pnpm exec vite build

FROM caddy:2.8-alpine AS runtime
COPY --from=builder /app/apps/web/dist /srv
COPY apps/web/Caddyfile.runtime /etc/caddy/Caddyfile
EXPOSE 80
