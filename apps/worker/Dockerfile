FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/worker/package.json ./apps/worker/
COPY packages ./packages/
RUN pnpm install --frozen-lockfile=false --filter @selfbase/worker...

FROM base AS runtime
COPY --from=deps /app /app
COPY apps/worker ./apps/worker
COPY packages ./packages
WORKDIR /app/apps/worker
ENV NODE_ENV=production
CMD ["pnpm", "exec", "tsx", "src/main.ts"]
