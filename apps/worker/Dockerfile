FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Worker needs the docker CLI to run `docker compose` against the host's
# socket (mounted at /var/run/docker.sock). We use the official Docker CE
# CLI from get.docker.com — smaller than docker.io and matches the host.
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update -qq \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/worker/package.json ./apps/worker/
COPY packages ./packages/
RUN pnpm install --frozen-lockfile=false --filter @supastack/worker...

FROM base AS runtime
COPY --from=deps /app /app
COPY apps/worker ./apps/worker
COPY packages ./packages
# Per-project compose template, baked in so the image is self-contained
# (registry-pullable without the source repo). provision.ts reads it at
# TEMPLATE_DIR (/app/infra/supabase-template) — previously a bind-mount,
# which silently became an empty dir on hosts without the repo checkout.
# Template changes now ship as a new worker image (versioned, auditable).
COPY infra/supabase-template ./infra/supabase-template
WORKDIR /app/apps/worker
ENV NODE_ENV=production
CMD ["pnpm", "exec", "tsx", "src/main.ts"]
