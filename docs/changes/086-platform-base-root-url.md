# 086 — Platform Studio base=root + legacy studio to /setup (gated) + real backups

Spec: [specs/086-platform-base-root-url/spec.md](../../specs/086-platform-base-root-url/spec.md) ·
Plan: [specs/086-platform-base-root-url/plan.md](../../specs/086-platform-base-root-url/plan.md)

## What shipped (by user story)

| Story | What | State |
|---|---|---|
| **US1** | Platform studio API base → apex root: management calls resolve as `/v1/*`, platform as `/platform/*` (no `/api/v1/v1/*`). server.ts root mount + Caddy `/v1*` (Caddyfile + `caddy-config.ts`) + `NEXT_PUBLIC_API_URL` flip + Studio rebuild + shim removal. | code done; **deploy pending** |
| **US2** | Legacy SPA (`apps/web`) reduced to the `/setup` wizard only. | done |
| **US3** | Setup reuses `createOrganizationWithOwner`; first user via GoTrue. | done |
| **US5** | Setup-completion gate: until setup done, `caddy-config.ts` emits a 302→`/setup` catch-all; `reloadCaddy()` unconditional; boot Caddyfile gated default. | done |
| **US6** | Real database backups in the platform studio: `/platform/database/:ref/backups` (Cloud shape) + `/restore-physical` + `GET /platform/projects/:ref/status`, reusing the feature-019 engine/worker. Migration `0019_backup_seq.sql` (numeric surrogate). | done |

## Coordinated deploy (US1 cutover — operator-run on the VM)

The US1 edits MUST land together — a base=root Studio without the Caddy `/v1*` route would 404 every management call. Migration `0019` (US6) and the gate (US5) also ride this deploy.

```bash
# 1. Sync source to the VM
rsync -a --delete <local>/ ubuntu@148.113.1.164:/opt/supastack/

# 2. Rebuild + restart the API (applies: root platformMisc mount, Caddy /v1* runtime
#    rule via caddy-config.ts, US5 gate, US6 routes, migration 0019 at boot).
ssh ubuntu@148.113.1.164
cd /opt/supastack/infra
sudo docker compose build api && sudo docker compose up -d api
#    The api reloads Caddy on boot (caddy-config.ts → /load), installing the apex
#    /v1* route + the setup-gate catch-all + dropping it if setup is already done.

# 3. Rebuild Studio so NEXT_PUBLIC_API_URL=apex-root is baked in (build-time var).
rm -rf "$STUDIO_SOURCE_DIR/apps/studio/.next"
sudo docker compose up -d --force-recreate studio

# 4. Verify (see quickstart §1, §6, §7):
#    - 0 requests to /api/v1/v1/* in the studio network panel
#    - https://<apex>/v1/projects/<ref>/api-keys → 200
#    - https://<apex>/platform/profile → 200
#    - pre-setup: GET / → 302 /setup ; post-setup: GET / → studio
#    - Backups page lists real backups; restore → RESTORING → ACTIVE_HEALTHY

# 5. ONLY after the rebuilt Studio is confirmed live (T012): remove the
#    /api/v1/v1/* shim (server.ts) + the /api/v1-prefixed platform mounts, then
#    rebuild api again. Guard: `grep -rn "/api/v1/v1" apps/api/src` → no matches.
```

## Rollback

Before shim removal (step 5), rollback is a clean image revert: restore the previous
Studio image (its `NEXT_PUBLIC_API_URL=…/api/v1` build) **together with** reverting the
API/Caddy change. The `/api/v1`-prefixed platform mounts + the `/api/v1/v1/*` shim are
still present until step 5, so an old-base Studio keeps working during the window.

- **Setup gate (US5)**: if anything goes wrong with the gate, it fails safe toward
  `/setup` (a DB-read error in `caddy-config.ts` emits the gated catch-all). The boot
  `Caddyfile` also defaults gated.
- **Backups (US6)**: migration `0019` is idempotent + additive; re-running is a no-op.
  The `/v1` CLI backup contract (uuid) is unchanged — CLI/MCP unaffected.

## Notes

- Login is unaffected by the base flip — Studio auth uses the separate
  `NEXT_PUBLIC_GOTRUE_URL=/auth/v1` (→ `auth:9999`), not `NEXT_PUBLIC_API_URL`.
- `caddy-config.ts` (runtime, DB-driven) is the production source of truth; the static
  `Caddyfile` only matters at first boot before the first `/load`.
- **Queue-name drift fixed (post-deploy):** the live restore test exposed that the api
  enqueued `selfbase.*` while the worker consumed `supastack.*` (half-done rename) —
  silently dropping restore **and** backup/lifecycle/pg-edge-cert/pooler/vault jobs from
  six producers. Fixed with a single shared `QUEUES` constant (`@supastack/shared`) that
  both sides import, a guard contract test (`apps/api/tests/contract/queue-name-contract.test.ts`),
  and Constitution v1.1.0 (Principle V queue-name clause + Queue-name gate).
- Follow-ups: make platform **audit** routes real; rehome a browser e2e harness to target
  Studio; remove the redundant `/api/v1` façade copies (+ migrate their tests).
