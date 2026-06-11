# syntax=docker/dockerfile:1.7
# supastack/studio-platform — domain-agnostic Supabase Studio image, IS_PLATFORM=true.
#
# Derived from the upstream apps/studio/Dockerfile (vanilla supabase monorepo) with
# two changes:
#   1. The four platform NEXT_PUBLIC_* vars are baked at `next build` time with a
#      PLACEHOLDER host (apex-placeholder.supastack.invalid). NEXT_PUBLIC_* values
#      are string-inlined into the JS bundles by Next.js — they cannot be read at
#      runtime — so a placeholder is the only way to keep one image domain-agnostic.
#   2. A custom entrypoint rewrites the placeholder to the real runtime
#      SUPASTACK_APEX across /app before starting the standalone server.
#
# BUILD — canonical source is the supastack fork of the supabase monorepo:
#   repo:   https://github.com/kmhari/supabase
#   branch: supastack-studio   (upstream + supastack patches, e.g. email-only sign-in)
#
#   git clone --depth 1 -b supastack-studio https://github.com/kmhari/supabase /tmp/supabase-src
#   docker build /tmp/supabase-src \
#     -f infra/studio-platform/Dockerfile \
#     -t supastack/studio-platform:$(git -C /tmp/supabase-src rev-parse --short HEAD)
#
# (Context = the monorepo checkout, NOT this repo. The VM's /opt/supabase-vanilla is
# a checkout of that same branch and works as a context too.)
#
# The sibling Dockerfile.dockerignore (BuildKit per-Dockerfile ignore) extends the
# upstream ignore set with `**/.env` — a fresh clone is clean, but lived-in checkouts
# (the VM's carries apps/studio/.env with real secrets + NEXT_PUBLIC_SITE_URL) must
# never feed a publishable image. Keep the guard regardless of context.
#
# RUN:
#   docker run -e SUPASTACK_APEX=<apex> -p 3000:3000 supastack/studio-platform:<tag>

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update -qq && \
  apt-get install -y --no-install-recommends \
  git \
  python3 \
  ca-certificates \
  build-essential && \
  rm -rf /var/lib/apt/lists/* && \
  update-ca-certificates

RUN npm install -g pnpm@10.24.0

WORKDIR /app

# Prune to the studio workspace (same as upstream)
FROM base AS turbo
COPY . .
RUN pnpm dlx turbo@2.9.3 prune studio --docker

FROM base AS deps
COPY --from=turbo /app/out/json ./
COPY --from=turbo /app/out/pnpm-lock.yaml ./
COPY ./patches/ ./patches
RUN pnpm install --frozen-lockfile

# Compile Next.js with the placeholder apex baked in
FROM deps AS builder
COPY --from=turbo /app/out/full ./

ARG APEX_PLACEHOLDER=apex-placeholder.supastack.invalid
# csp.ts / _app.tsx do `new URL(...)` on these — they MUST be absolute URLs, which
# is exactly why a relative base cannot work and substitution is required.
ENV NEXT_PUBLIC_IS_PLATFORM=true
ENV NEXT_PUBLIC_API_URL=https://api.${APEX_PLACEHOLDER}
ENV NEXT_PUBLIC_GOTRUE_URL=https://${APEX_PLACEHOLDER}/auth/v1
ENV NEXT_PUBLIC_BASE_PATH=/dashboard
ENV NEXT_TELEMETRY_DISABLED=1

RUN NODE_OPTIONS=--max-old-space-size=14336 pnpm --filter studio exec next build

# Final image: standalone server + static assets + substitution entrypoint
FROM base AS production
COPY --from=builder /app/apps/studio/public ./apps/studio/public
COPY --from=builder /app/apps/studio/.next/standalone ./
COPY --from=builder /app/apps/studio/.next/static ./apps/studio/.next/static

COPY <<'EOF' /usr/local/bin/studio-platform-entrypoint.sh
#!/bin/sh
# Rewrite the build-time placeholder apex to the runtime SUPASTACK_APEX, once per
# container. NEXT_PUBLIC_* inlines are literal strings in the bundles, so a plain
# textual substitution is sufficient (the token's dots/hyphens survive URL-encoding,
# so encoded occurrences are caught too).
set -eu
: "${SUPASTACK_APEX:?SUPASTACK_APEX is required (runtime apex for URL substitution)}"
PLACEHOLDER="apex-placeholder.supastack.invalid"
MARKER=/app/.apex-substituted

if [ -f "$MARKER" ]; then
  baked="$(cat "$MARKER")"
  if [ "$baked" != "$SUPASTACK_APEX" ]; then
    echo "FATAL: this container was substituted for '$baked' but SUPASTACK_APEX is now '$SUPASTACK_APEX'." >&2
    echo "Recreate the container (docker compose up -d --force-recreate studio) to re-substitute from the pristine image." >&2
    exit 1
  fi
else
  echo "studio-platform: substituting $PLACEHOLDER -> $SUPASTACK_APEX"
  grep -rl --binary-files=without-match "$PLACEHOLDER" /app | while read -r f; do
    sed -i "s/$PLACEHOLDER/$SUPASTACK_APEX/g" "$f"
  done
  printf '%s' "$SUPASTACK_APEX" > "$MARKER"
  if grep -rq --binary-files=without-match "$PLACEHOLDER" /app; then
    echo "FATAL: placeholder still present after substitution" >&2
    exit 1
  fi
  echo "studio-platform: substitution complete"
fi

# Belt-and-braces: correct values for any genuine runtime process.env read.
export NEXT_PUBLIC_API_URL="https://api.${SUPASTACK_APEX}"
export NEXT_PUBLIC_GOTRUE_URL="https://${SUPASTACK_APEX}/auth/v1"
export NEXT_PUBLIC_IS_PLATFORM=true
export NEXT_PUBLIC_BASE_PATH=/dashboard

exec node apps/studio/server.js
EOF
RUN chmod +x /usr/local/bin/studio-platform-entrypoint.sh

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
# NOT upstream's /api/platform/profile: local stub routes answer 404
# "Endpoint not supported on hosted" in IS_PLATFORM=true builds. get-utc-time is a
# plain route that stays enabled, shifted under the baked basePath.
HEALTHCHECK --interval=5s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:3000/dashboard/api/get-utc-time').then((r) => {if (r.status !== 200) throw new Error(r.status)})"
ENTRYPOINT ["studio-platform-entrypoint.sh"]
