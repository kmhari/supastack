# Supastack Studio image.
#
# Builds Supabase Studio from the upstream `supabase/supabase` repo at a pinned
# commit, with `NEXT_PUBLIC_BASE_PATH=/studio` baked in. Because each managed
# instance has its own subdomain `<ref>.<apex>`, the path part is constant —
# so a single image is reused by every instance's compose stack (no per-instance
# image build needed; see specs/.../research.md §2).
#
# Build args:
#   SUPABASE_COMMIT      pinned commit SHA from infra/supabase-template/COMMIT
#   NEXT_PUBLIC_BASE_PATH default: /studio
#
# Usage (from repo root):
#   docker build \
#     --build-arg SUPABASE_COMMIT="$(cat infra/supabase-template/COMMIT)" \
#     -t supastack/studio:"$(cat infra/supabase-template/COMMIT)" \
#     -f infra/studio/Dockerfile \
#     infra/studio

# ─── Stage 1: fetch the upstream source ─────────────────────────────────────
FROM alpine/git:latest AS source
ARG SUPABASE_COMMIT
WORKDIR /src
RUN test -n "$SUPABASE_COMMIT" || (echo "SUPABASE_COMMIT build-arg required" && exit 1)
RUN git clone --filter=blob:none https://github.com/supabase/supabase.git . \
 && git checkout "$SUPABASE_COMMIT"

# ─── Stage 2: base toolchain ────────────────────────────────────────────────
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends \
      git python3 ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/* \
 && update-ca-certificates \
 && npm install -g pnpm@10.24.0

WORKDIR /app

# ─── Stage 3: turbo prune (selects only what studio + its deps need) ────────
FROM base AS turbo
COPY --from=source /src ./
RUN pnpm dlx turbo@2.9.3 prune studio --docker

# ─── Stage 4: install pruned deps ───────────────────────────────────────────
FROM base AS deps
COPY --from=turbo /app/out/json ./
COPY --from=turbo /app/out/pnpm-lock.yaml ./
COPY --from=turbo /app/patches/ ./patches
RUN pnpm install --frozen-lockfile

# ─── Stage 5: build Studio with our basePath ────────────────────────────────
FROM deps AS builder
COPY --from=turbo /app/out/full ./

ARG NEXT_PUBLIC_BASE_PATH=/studio
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
# Studio's next.config.ts reads NEXT_PUBLIC_BASE_PATH at build time and bakes
# it into every asset URL. Setting it here is the entire point of the image.

# Disable Sentry uploads during build (no DSN configured for self-hosted)
ENV SENTRY_DSN= \
    SENTRY_UPLOAD_DRY_RUN=true \
    NEXT_PUBLIC_IS_PLATFORM=false \
    NEXT_PUBLIC_ENVIRONMENT=production

RUN pnpm --filter studio exec next build

# ─── Stage 6: production runtime ────────────────────────────────────────────
FROM base AS production

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone build output includes node_modules trace; no extra install needed.
COPY --from=builder /app/apps/studio/public ./apps/studio/public
COPY --from=builder /app/apps/studio/.next/standalone ./
COPY --from=builder /app/apps/studio/.next/static ./apps/studio/.next/static

# Re-declare the build-arg as a runtime label so consumers can see what's baked.
ARG NEXT_PUBLIC_BASE_PATH=/studio
LABEL org.supastack.next-base-path="${NEXT_PUBLIC_BASE_PATH}"
LABEL org.supastack.supabase-commit="${SUPABASE_COMMIT:-unknown}"

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000${NEXT_PUBLIC_BASE_PATH}/api/platform/profile').then(r => { if (r.status >= 500) throw new Error(r.status) })"

CMD ["node", "apps/studio/server.js"]
