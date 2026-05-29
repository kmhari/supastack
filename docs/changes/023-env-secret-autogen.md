# Feature 023 — Env Secret Auto-Generation & SELFBASE_APEX DB Migration

**Issue**: #75 | **Branch**: `023-env-secret-autogen`

## What Changed

### install.sh — all 6 secrets auto-generated

Previously `install.sh` only generated 3 secrets (`MASTER_KEY`, `SESSION_SECRET`, `CONTROL_DB_PASSWORD`) and skipped the block entirely if `.env` already existed. This meant `SUPAVISOR_SECRET_KEY_BASE`, `SUPAVISOR_VAULT_ENC_KEY`, and `SUPAVISOR_API_JWT_SECRET` were never auto-generated — causing failures on any machine that didn't have them pre-populated.

Now `install.sh` uses an idempotent `update_env_var KEY VALUE` function (from Coolify's installer) that:

- Fills in empty `KEY=` entries
- Appends missing entries
- **Leaves non-empty entries untouched** (safe to re-run)

Auto-generated secrets:

| Variable                    | Command                             |
| --------------------------- | ----------------------------------- |
| `MASTER_KEY`                | `openssl rand -hex 32`              |
| `SESSION_SECRET`            | `openssl rand -hex 32`              |
| `CONTROL_DB_PASSWORD`       | `openssl rand -base64 32` (cleaned) |
| `SUPAVISOR_SECRET_KEY_BASE` | `openssl rand -base64 48`           |
| `SUPAVISOR_VAULT_ENC_KEY`   | `openssl rand -hex 16`              |
| `SUPAVISOR_API_JWT_SECRET`  | `openssl rand -hex 32`              |

### infra/.env.example — complete variable reference

All 13 environment variables (7 required + 6 optional) are now documented with purpose, generation command, and whether `install.sh` handles them.

### scripts/dev-env.sh — recovery script

If `.env` is lost while containers are still running:

```bash
bash scripts/dev-env.sh > recovered.env
chmod 600 recovered.env
cp recovered.env infra/.env   # or wherever INSTALL_DIR points
```

Extracts all 6 secrets from running containers via `docker inspect`. Prints warnings for any variable not found.

### SELFBASE_APEX no longer required for API and MCP containers

The API and MCP services now resolve the apex domain from `org.apex_domain` in the control-plane database, with a 60-second in-process TTL cache. `SELFBASE_APEX` is retained as an optional env-var override.

**Caddy and Supavisor still require `SELFBASE_APEX`** in `.env` — they have no database access.

Affected files:

- `apps/api/src/services/apex-resolver.ts` — new shared service
- `apps/api/src/plugins/auth.ts` — OAuth issuer/audience from DB
- `apps/api/src/routes/oauth/discovery.ts` — discovery endpoint from DB
- `apps/api/src/routes/oauth/token.ts` — token endpoint from DB
- `apps/mcp/src/server.ts` — MCP metadata from DB, refreshed every 60s

## Secret Rotation Guide

| Secret                      | Impact                                               | Procedure                                                                                                                            |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MASTER_KEY`                | **All per-instance secrets encrypted with this key** | See feature 018 runbook (`docs/changes/018-master-key-rotation.md`) — requires re-encryption of all `encryptedSecrets` rows          |
| `SESSION_SECRET`            | All active sessions invalidated                      | Update `.env`, restart api. Users must log in again. Zero downtime possible with blue/green.                                         |
| `CONTROL_DB_PASSWORD`       | Postgres auth                                        | Update `.env` + Postgres `ALTER ROLE selfbase PASSWORD '...'`, restart all containers.                                               |
| `SUPAVISOR_SECRET_KEY_BASE` | Supavisor internal state                             | Update `.env`, restart supavisor. Active pooler connections drop briefly.                                                            |
| `SUPAVISOR_VAULT_ENC_KEY`   | Supavisor vault encryption                           | Update `.env`, restart supavisor.                                                                                                    |
| `SUPAVISOR_API_JWT_SECRET`  | API↔Supavisor admin JWTs                             | Update `.env`, restart api + worker + supavisor simultaneously.                                                                      |
| `SELFBASE_APEX`             | Domain routing                                       | Update `.env`, restart caddy + supavisor. API and MCP pick up the new value from DB within 60s (no restart needed if DB is updated). |

## Deployment Notes

Standard `install.sh` re-run will fill any missing Supavisor secrets without touching existing values. No migrations required.

```bash
bash install.sh  # safe to re-run; existing secrets preserved
```
