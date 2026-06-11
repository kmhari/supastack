# Quickstart — Feature 117 verification

## Local (unit / contract / build)

```bash
# Single accessor + local-domain gate
npx vitest run packages/shared/tests/apex.test.ts \
  apps/api/tests/unit/setup-local-gate.test.ts
# Single-source invariant — fails if any prod code reads installation.apexDomain
npx vitest run apps/api/tests/contract/no-apex-domain-reader.test.ts
# Installer resolution-order logic (pure helper)
#   arg > env > .env > /dev/tty prompt > warned localhost; curl|bash still prompts
# Build + typecheck + lint (web wizard trimmed, schemas updated)
pnpm -w build && pnpm -w lint
# Migration re-appliable (idempotent): apply twice → no-op the second time
```

Expected: `getApex()`/`isRealApex()` correct (`localhost`/empty/no-dot → not real); `/setup` blocks on a local/default domain; **zero** `installation.apexDomain` references in production source; `apex-resolver.ts` gone; build + lint clean.

## Live (supaviser.dev)

1. **`/apex` is env-backed** — `GET /api/v1/apex` returns `supaviser.dev` (sourced from env, not the dropped column).
2. **`/setup` skips the domain question** — open `/setup`: no domain-entry field; it lands directly on the DNS-records step for `supaviser.dev`; cert/HTTPS state reflects the live cert.
3. **No divergent write** — confirm `PATCH /api/v1/org` no longer accepts `apexDomain`; confirm `POST /api/v1/setup` body has no `apexDomain`.
4. **Routing intact after column drop** — Caddy config still routes `supaviser.dev`, `*.supaviser.dev`, and the 3 projects (`buildCaddyConfig` now reads env); a project page + a per-instance subdomain still resolve.
5. **Worker apex intact** — a provision/pooler-reconcile cycle still builds correct `<ref>.supaviser.dev` hosts (worker now reads `SUPASTACK_APEX` from its env).
6. **Installer** — on a throwaway box: `curl … | bash` **prompts** for the domain (no silent `localhost`); `./install.sh supaviser.dev` uses the arg; both persist to `.env`.

## Migration / deploy

- One migration `0024_drop_installation_apex_domain.sql` (idempotent, destructive: `DROP COLUMN IF EXISTS`).
- `infra/docker-compose.yml`: **worker** gains `SUPASTACK_APEX` — the worker must be **recreated** (not just restarted) to pick up the new env: `docker compose up -d worker`.
- Rebuild order: migration runs on `api` boot → rebuild `api` + `worker` + `web` (wizard) + `packages` (shared accessor/schema). No Studio rebuild, no Caddy boot-config change, no new dependency.
- Rollback: re-add the column (additive) + revert the readers; the env value is unaffected, so no data loss (the column was redundant).
