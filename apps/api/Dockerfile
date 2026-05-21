# selfbase API image — minimal node + tsx for v1 (no compiled bundle yet).
# A production tsc-built bundle lands in a later phase; v1 ships dev-style.
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages ./packages/
RUN pnpm install --frozen-lockfile=false --filter @selfbase/api...

FROM base AS runtime
COPY --from=deps /app /app
COPY apps/api ./apps/api
COPY packages ./packages
# tsx-based startup; tsc bundle comes later.
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
