# selfbase MCP HTTP service — feature 014.
# Wraps upstream @supabase/mcp-server-supabase as a Streamable HTTP transport
# at mcp.<apex>/mcp, gated by selfbase OAuth bearer tokens.
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/mcp/package.json ./apps/mcp/
COPY packages ./packages/
RUN pnpm install --frozen-lockfile=false --filter @selfbase/mcp...

FROM base AS runtime
COPY --from=deps /app /app
COPY apps/mcp ./apps/mcp
COPY packages ./packages
WORKDIR /app/apps/mcp
ENV NODE_ENV=production
EXPOSE 3002
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
