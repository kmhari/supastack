# Quickstart — Feature 116 verification

## Local (unit/contract)

```bash
# Pure helpers + redaction + capacity math + collector (fake docker)
npx vitest run apps/web/tests/unit/snippets.test.ts \
  apps/api/tests/unit/job-redactor.test.ts \
  apps/api/tests/unit/admin-*.test.ts \
  apps/worker/tests/unit/observer.test.ts
# RBAC matrix must cover the new admin.* actions
npx vitest run packages/shared/tests/rbac-matrix.test.ts
# Migration idempotency (re-run sequence twice = no-op)
# Build + typecheck
pnpm -w build && pnpm -w lint
```

Expected: snippet personalization (apex vs `<your-apex>` fallback), per-editor MCP JSON shape, `failedReason` redaction (postgres URL / `sbp_` / Bearer masked), capacity math (used/free + avg footprint, **no** "N more"), observer aggregation per project from fake `docker stats`, RBAC grants `owner`+`administrator` only.

## Live (supaviser.dev)

1. **Docs (public, no auth)** — open `https://<apex>/docs/cli` and `/docs/mcp`:
   - snippets show the real apex; Copy buttons work; MCP editor tabs render; reachable signed-out.
2. **Admin gate** — open `https://<apex>/admin`:
   - signed-in admin (owner/administrator) → console loads; non-admin / signed-out → denied.
   - Confirm a non-admin session gets `403` from `GET /api/v1/admin/fleet` directly.
3. **Fleet/health/system (US2)** — fleet lists all projects across orgs; a project detail shows services/versions/db; system shows control-plane health + commit; logs show per-project (fresh) + control-plane (≤60s) entries.
4. **Resources (US3)** — after the observer has ticked: host totals + per-project usage + disk breakdown + avg footprint; a project trend renders; before first tick → "collecting" empty state.
5. **Queues (US4)** — each queue shows counts; a forced failure appears with redacted reason; `job.data` never present in the response.
6. **Cert/DNS/backups (US5)** — wildcard expiry + days-left + warning state; per-project certs; apex/wildcard DNS readiness; per-project last-backup + total backup storage.

## Deploy

- `web` rebuild (docs + admin UI) + Caddy reload (api) for `/docs*` + `/admin*` routes.
- `api` rebuild (admin endpoints + RBAC).
- `worker` rebuild (observer job).
- one DB migration (`resource_samples` + `control_plane_snapshots`) — idempotent; safe to re-run.
- No new dependency; no `/v1/*` change.
