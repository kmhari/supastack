# Quickstart — verify feature 107 (API host-parity + scoped CORS)

## 1. CORS contract (unit/contract — SC-003/SC-006)

```bash
pnpm exec vitest run cors-policy caddy-config
```
- dashboard origin → exact `Access-Control-Allow-Origin: https://<apex>`
- foreign origin → no allow-origin header
- preflight `OPTIONS` → allowed methods + full header allow-list (incl. `x-connection-encrypted`, `x-pg-application-name`, `x-request-id`); no `Allow-Credentials`
- `caddy-config` test: `api.<apex>` host route → `/platform/*` + `/v1/*` → `api:3001`, terminal, no studio catch-all

## 2. No regression (SC-004)

```bash
pnpm exec vitest run --project @supastack/api          # full suite green
pnpm exec vitest run management-api contract            # /v1 contract — 0 drift
pnpm --filter @supastack/web build                      # studio builds with the new base
```

## 3. Live cross-origin (operator, on the VM after deploy — SC-001/002/003)

Order: deploy **api** first, then Studio.

```bash
# a) scoped CORS live + foreign-origin rejected, BEFORE repointing Studio
curl -s -D- -o /dev/null -H "Origin: https://<apex>"  https://api.<apex>/platform/profile | grep -i access-control-allow-origin   # → https://<apex>
curl -s -D- -o /dev/null -H "Origin: https://evil.example" https://api.<apex>/platform/profile | grep -i access-control-allow-origin || echo "no grant ✓"
# b) preflight for the pg-meta POST
curl -s -D- -o /dev/null -X OPTIONS https://api.<apex>/platform/pg-meta/<ref>/query \
  -H "Origin: https://<apex>" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type,x-connection-encrypted" | grep -i access-control
# c) api.<apex>/ does NOT serve the studio
curl -s -o /dev/null -w '%{http_code}\n' https://api.<apex>/    # → 404 (not the dashboard)

# d) then rebuild Studio with NEXT_PUBLIC_API_URL=https://api.<apex>; in the browser:
#    - every project page loads, 0 CORS errors in console (SC-001)
#    - sign-in works (apex /auth/v1, same-origin) (SC-002)
#    - SQL editor / pg-meta query + a mutation (create trigger) succeed cross-origin
```

## 4. CLI / MCP unchanged (SC-004)

```bash
# CLI already targets api.<apex>/v1 — list/migration/gen-types succeed identically
supabase projects list   # (configured for api.<apex>)
```

## 5. Rollback (SC-005)

Revert `NEXT_PUBLIC_API_URL` → `https://<apex>` + `--force-recreate studio` (wipe `.next`). Same-origin restored; no api/CORS change needed (apex dual-serves). The scoped CORS can stay (it only tightens the prior posture).

## Success mapping

| SC | Verified by |
|---|---|
| SC-001 dashboard works cross-origin | §3d browser + §1 |
| SC-002 login unchanged | §3d sign-in |
| SC-003 foreign origin rejected | §1 + §3a |
| SC-004 CLI/MCP/`/v1` no regression | §2 + §4 |
| SC-005 clean rollback | §5 |
| SC-006 CORS + host-route covered by tests | §1 + §2 |
