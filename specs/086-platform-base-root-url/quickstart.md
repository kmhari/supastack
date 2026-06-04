# Quickstart — Verifying feature 086

Env: `APEX=supaviser.dev`, `TOKEN=<operator GoTrue JWT or admin PAT>`, `REF=<a running project>`.

## 1. Clean URLs (US1 / SC-001, SC-002)

In the platform studio (`https://$APEX/dashboard`), open a project and watch the network panel:
- ✅ Management-compat calls go to `https://$APEX/v1/projects/$REF/...` (200).
- ✅ Platform calls go to `https://$APEX/platform/...` (200).
- ✅ **Zero** requests to any `…/api/v1/v1/…` path.

Curl checks:
```
curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" \
  "https://$APEX/v1/projects/$REF/api-keys?reveal=false"        # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" \
  "https://$APEX/platform/profile"                              # 200 (was only /api/v1/platform/profile)
curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $TOKEN" \
  "https://$APEX/v1/projects/$REF/branches"                     # 200, no /v1/v1
```

## 2. /setup still works (US2 / SC-003)

- Over HTTPS: `https://$APEX/setup` loads the wizard; `GET /api/v1/setup/status` responds.
- Pre-DNS (fresh VM): `http://<server-ip>/setup` loads over plain HTTP.
- The slimmed SPA: navigating to any former route (e.g. `/dashboard`, `/settings/org`) inside the apps/web bundle redirects to `/setup` (catch-all) — those pages no longer exist.
- `vite build` of `apps/web` succeeds (no dangling imports).

## 3. Setup reuses the platform org primitive (US3 / SC-006)

On a clean control plane, run setup, then:
```
# operator is a GoTrue user (no public.users row)
psql "$CONTROL_DB" -c "select count(*) from auth.users where email='<op>';"   # 1
# the org is owned by the operator and visible via the platform API
curl -s -H "authorization: Bearer $TOKEN" "https://$APEX/platform/organizations" | jq '.[].slug'
```
Unit: `pnpm --filter @supastack/api test org-store` (createOrganizationWithOwner inserts org + owner membership).

## 4. No regression (US4 / SC-004, SC-007)

```
# CLI / Management API at api.<apex> unchanged
supabase migration list --linked            # works
supabase db push --linked                    # works
# login
# (browser) sign in to the studio → dashboard loads
# the /api/v1 engine still serves the platform studio's internal delegations:
#   - create a project in the studio  → provisions (delegates to /api/v1/instances → worker)
#   - studio restart action            → restarts (delegates to /api/v1/instances/:ref/restart)
```
Unit/contract: `pnpm --filter @supastack/api test` (the `/v1` contract tests pass — no contract drift).
Integration (live VM): `tests/integration/{provision-instance,backup,backup-retention}.test.ts` pass (the `/api/v1` engine is retained).

## 5. Shim gone (US1 end state)

```
grep -rn "/api/v1/v1" apps/api/src    # → no matches (shim removed)
```

## 6. Setup-completion gate (US5 / SC-008)

```
# Pre-setup (setup_state.completed_at IS NULL): dashboard routes redirect to /setup
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://$APEX/"               # 302 …/setup
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://$APEX/dashboard"       # 302 …/setup
curl -s -o /dev/null -w '%{http_code}\n' "https://$APEX/api/v1/setup/status"             # 200 (setup itself reachable)
# Complete setup, then:
curl -s -o /dev/null -w '%{http_code}\n' "https://$APEX/"                                 # 200 (studio; no redirect)
# A data-plane host stays reachable throughout:
curl -s -o /dev/null -w '%{http_code}\n' "https://$REF.$APEX/rest/v1/"                    # not 302→/setup
```

## 7. Real database backups (US6 / SC-009)

```
# List — real backups in the Studio shape (numeric ids)
curl -s -H "authorization: Bearer $TOKEN" "https://$APEX/platform/database/$REF/backups" \
  | jq '{region, pitr_enabled, walg_enabled, ids: [.backups[].id], statuses: [.backups[].status]}'
# → ids are numbers; statuses UPPERCASE (COMPLETED)

# Restore — by the numeric id from the list → 201; project goes RESTORING → ACTIVE_HEALTHY
BID=$(curl -s -H "authorization: Bearer $TOKEN" "https://$APEX/platform/database/$REF/backups" | jq '.backups[0].id')
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"id\":$BID}" \
  "https://$APEX/platform/database/$REF/backups/restore-physical"                         # 201
curl -s -H "authorization: Bearer $TOKEN" "https://$APEX/platform/projects/$REF/status"   # {"status":"RESTORING"}
# …poll until:                                                                            # {"status":"ACTIVE_HEALTHY"}

# CLI /v1 backup contract unchanged (uuid):
supabase ... # backups list/restore against api.$APEX/v1 still uuid-based, unaffected
```
Unit: `pnpm exec vitest run backups-mgmt platform` (Studio-shape mapping, seq↔uuid resolve, status map). Migration idempotency: re-run `packages/db/migrations/0019_backup_seq.sql` is a no-op.
