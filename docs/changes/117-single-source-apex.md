# Feature 117 — Single-Source Apex (domain set once at install; `/setup` guides DNS)

**Branch**: `117-setup-first-bootstrap` · **Spec**: [specs/117-setup-first-bootstrap/spec.md](../../specs/117-setup-first-bootstrap/spec.md) · **Closes**: #110

## What changed

The apex domain is now the **single source of truth** from `SUPASTACK_APEX` (env), read directly everywhere. The duplicate `installation.apex_domain` DB column is **dropped**, and `/setup` no longer asks for the domain — it reads the established apex and guides DNS + certificate issuance (blocking on a local/default domain). The installer's domain prompt is hardened to work under `curl | bash`.

Previously the domain lived in two places that could silently disagree: `SUPASTACK_APEX` (used by OAuth/GoTrue/Studio/CORS/Caddy) and `installation.apex_domain` (written by `/setup`, read by Caddy routing + certs). `/setup`'s domain field looked authoritative but was mostly dead (#110).

### Backend (single source)
- **New** `@supastack/shared` accessor: `getApex()` / `getApexOrThrow()` / `isRealApex()` (`packages/shared/src/apex.ts`). `getApex*` read `process.env.SUPASTACK_APEX`; `isRealApex` is a pure predicate (false for `localhost`/empty/no-dot), safe to import in the web bundle.
- **~20 readers repointed** from `installation.apexDomain` to `getApex()` across `apps/api` (apex, server, wildcard-certs, tls-ask, connect-cli, instances, pooler-status, admin, pg-edge-cert-internal, caddy-config, pooler-tenants) and `apps/worker` (provision, pooler-reconciler).
- **Writes removed**: `setup.ts` no longer writes apex into the installation upsert; `PATCH /api/v1/org` no longer accepts/writes/reloads on `apexDomain` (the apex-change path is gone).
- **Dead code deleted**: `apps/api/src/services/apex-resolver.ts` (the unreachable two-source `resolveApex`).
- **Migration `0024_drop_installation_apex_domain.sql`**: `ALTER TABLE installation DROP COLUMN IF EXISTS apex_domain;` (idempotent, explicitly destructive — Constitution I). The Drizzle `installation` schema drops the column.
- **Idempotency fix in `0018`**: the historical `org → installation` data-copy now guards on the `apex_domain` column existing, so re-running the full migration sequence after `0024` is a clean no-op. (No-op on an already-set-up installation, where the existing row-exists guard already skips the copy.)

### Frontend (`/setup` guides DNS, never asks)
- `Setup.tsx` `DomainCertsStep`: removed the `enter-apex` input + the `orgApi.patch({apexDomain})` write. It reads the env-backed apex (via the parent's `apexApi.status()`), lands directly on the DNS-records step (apex A + wildcard A + ACME TXT — unchanged UI), and **blocks** with a "re-run the installer with a real domain" message when `isRealApex(apex)` is false.
- `apexDomain` dropped from the `setupApi.run` / `orgApi.patch` body types and the shared Zod `SetupRequest` / `OrgPatchRequest` schemas.

### Installer (`install.sh`)
- Domain capture resolves: **positional arg `$1` → `SUPASTACK_APEX` env → existing `.env` → prompt (read from `/dev/tty`) → warned `localhost`**.
- The `/dev/tty` read is the key fix: `curl … | bash` makes stdin the pipe, so the old `[[ -t 0 ]]` test was false and **silently defaulted to localhost**. Reading the prompt from `/dev/tty` makes the piped install prompt too.
- `./install.sh supaviser.dev` now works (positional form).

## ⚠️ Critical deploy detail — the worker needs a new env

The **worker** reads the apex in `provision.ts` + `pooler-reconciler.ts` but had **no `SUPASTACK_APEX` env**. `infra/docker-compose.yml` now sets `SUPASTACK_APEX: ${SUPASTACK_APEX:?…}` on the worker service. The worker MUST be **recreated** (not just restarted) to pick it up:

```
docker compose up -d worker      # recreate — a plain restart keeps the old env
```

## Deploy

1. Rsync source to the VM.
2. Rebuild `api` + `worker` + `web` (+ `packages`): `docker compose build api worker web && docker compose up -d api worker web`.
3. The migration `0024` runs on `api` boot.
4. **Recreate the worker** for `SUPASTACK_APEX` (step above) — `up -d`, not `restart`.
5. No Studio rebuild, no Caddy boot-config change, no new dependency, **no `/v1` change**.

## Rollback

The dropped column was redundant (env was already authoritative and equal on the live VM). To roll back: revert the code + re-add the column (additive). The env value is untouched, so there is no data loss.

## Verification

- **Local**: `packages/shared/tests/apex.test.ts`, `apps/api/tests/contract/no-apex-domain-reader.test.ts` (greppably fails if any prod source re-reads `installation.apexDomain`/`apex_domain` or imports `apex-resolver`), `apps/web/tests/unit/setup-domain-gate.test.ts` (no input + local block), `tests/installer/resolve-apex.test.ts` (capture order + `/dev/tty` wiring), and `tests/integration/migration-idempotency.test.ts` (run twice against a scratch Postgres — green after the `0018` guard).
- **Live smoke** (after deploy): `GET /api/v1/apex` returns the env apex; `/setup` shows no domain input and lands on the DNS step; Caddy routing + projects + per-instance subdomains still resolve after the column drop; a worker provision/pooler cycle builds correct `<ref>.<apex>` hosts; `curl|bash` install prompts (no silent localhost).

## Constitution

PASS. One explicitly-sanctioned destructive-but-idempotent migration (Principle I). No new RBAC action (Principle III) — the only change is removing a write from the already-authorized `/org`. No `/v1` drift (Principle IV). Worker env added, no queue change (Principle V). Security/correctness covered by unit + contract tests (Principle VI).
