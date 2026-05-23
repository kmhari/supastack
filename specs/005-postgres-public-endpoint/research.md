# Research: Postgres Public Endpoint via SNI Routing

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23

---

## Decision 1: Routing Technology — Caddy L4 Module

**Decision**: Use `github.com/mholt/caddy-l4` (the `caddy-l4` module) to add a TCP layer-4 server on port 5432 inside Caddy. This module extends Caddy with a `layer4` app that can read TLS SNI, match by hostname, and proxy to per-instance upstreams.

**Rationale**:
- caddy-l4 is the official upstream extension for TCP/L4 routing in Caddy. It integrates natively with Caddy's existing TLS certificate store, so the wildcard cert loaded via `tls.certificates.load_files` (feature 004) is automatically available for TLS termination on port 5432.
- No separate TLS infrastructure needed — the same wildcard `*.<apex>` cert covers `db.<ref>.<apex>`.
- All routing config lives in the same Caddy admin JSON (`buildCaddyConfig()`) that already manages HTTP routing. The full atomic reload via `POST :2019/load` covers both HTTP and L4 configs in one transaction.

**Alternatives considered**:
- HAProxy with SSL termination — external dependency, separate config file, separate lifecycle.
- stunnel as a sidecar — doesn't integrate with Caddy's cert store; adds another container.
- Nginx stream — same concerns; no Caddy integration.
- Direct host port exposure per instance — doesn't give the clean `db.<ref>.<apex>:5432` hostname the supabase CLI expects.

**Module location**: `github.com/mholt/caddy-l4`

---

## Decision 2: TLS Termination Strategy

**Decision**: **TLS termination at Caddy** — Caddy terminates TLS (using the wildcard cert), then proxies plaintext TCP to the per-instance Postgres at `host.docker.internal:<portPostgres>`.

**Rationale**:
- Per-instance Postgres containers run inside the instance's Docker Compose network (internal only). They accept plaintext Postgres connections from within the Docker network. Caddy already connects to Kong and Studio via `host.docker.internal:<port>` using the same pattern.
- TLS passthrough would require each per-instance Postgres to have a valid cert — not currently configured and unnecessarily complex for internal containers.
- Caddy's TLS termination is zero-cost in this topology since the TLS cert is already loaded.

**Postgres STARTTLS handling**: The Postgres TLS handshake is NOT a standard TLS-from-first-byte connection. Clients send an 8-byte SSLRequest message (magic number `80877103`) before the TLS ClientHello. Caddy-l4 includes a `postgres` handler module (`l4postgres`) specifically for this: it reads the SSLRequest bytes, responds with `S` (SSL accepted), and hands the connection to the TLS handler which then reads the proper ClientHello (including SNI).

**caddy-l4 handler chain for Postgres**:
```
TCP :5432
  → [postgres handler]  read SSLRequest, respond 'S'
  → [tls handler]       terminate TLS using wildcard cert, extract SNI
  → [subroute]          match SNI = db.<ref>.<apex> → proxy to host.docker.internal:<portPostgres>
```

---

## Decision 3: Caddy Dockerfile (custom build)

**Decision**: Create `apps/caddy/Dockerfile` using `xcaddy` to build Caddy with the `caddy-l4` module. This replaces the stock `image: caddy:2.8-alpine` in `docker-compose.yml`.

```dockerfile
FROM caddy:2.8-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-l4

FROM caddy:2.8-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

**Note**: Feature 004 (wildcard cert) kept stock Caddy because `acme-client` npm handles cert issuance and `tls.certificates.load_files` loads the cert from disk — no Caddy DNS plugin needed. This feature (005) is the first one that requires a custom Caddy build.

**docker-compose.yml change**:
```yaml
caddy:
  build:
    context: ..
    dockerfile: apps/caddy/Dockerfile
  # remove: image: caddy:2.8-alpine
  ports:
    - '80:80'
    - '443:443'
    - '5432:5432'   # ← new
```

---

## Decision 4: caddy-l4 Layer4 Config Shape

**Decision**: Add a `layer4` app to the Caddy JSON config (alongside the existing `tls` and `http` apps). The `layer4` app is only emitted when a wildcard cert exists AND an apex is configured — when neither condition holds, the config is identical to today.

**Config shape** (emitted by `buildCaddyConfig()` when wildcard active):
```json
{
  "apps": {
    "layer4": {
      "servers": {
        "postgres": {
          "listen": [":5432"],
          "routes": [
            {
              "match": [{"postgres": {}}],
              "handle": [
                {"handler": "postgres"},
                {
                  "handler": "subroute",
                  "routes": [
                    {
                      "match": [{"tls": {"sni": ["db.<ref1>.<apex>"]}}],
                      "handle": [
                        {"handler": "tls"},
                        {"handler": "proxy", "upstreams": [{"dial": "host.docker.internal:<portPostgres1>"}]}
                      ]
                    },
                    {
                      "match": [{"tls": {"sni": ["db.<ref2>.<apex>"]}}],
                      "handle": [
                        {"handler": "tls"},
                        {"handler": "proxy", "upstreams": [{"dial": "host.docker.internal:<portPostgres2>"}]}
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  }
}
```

**Important**: The exact module/handler names (`"postgres"`, `"tls"`, `"proxy"`, `"subroute"`) must be verified against the installed caddy-l4 version during implementation — caddy-l4 uses Caddy's module registration system and names can differ across versions. The reference is the caddy-l4 README and the `modules/` directory in the repo.

---

## Decision 5: POSTGRES_HOST Fix in compose-template.ts

**Decision**: Change `POSTGRES_HOST: 'db'` to `POSTGRES_HOST: \`db.${ref}.${apex}\`` in `packages/docker-control/src/compose-template.ts` when an apex is provided.

**Rationale**: Studio reads `POSTGRES_HOST` from its environment to display the "Direct connection" string. Currently it shows `db` (the Docker-internal hostname), which produces `127.0.0.1:5432` or `db:5432` in Studio's UI — neither meaningful to an external developer. With `db.<ref>.<apex>`, Studio shows the correct publicly-reachable hostname.

**Fallback**: When `apex` is an empty string or not configured, keep `POSTGRES_HOST: 'db'` (current behavior). The `apex` parameter is already required in `ComposeTemplateInputs` so the value is always available — but during the setup wizard before an apex is configured, instances can't be provisioned anyway (the wizard gate prevents it).

**Impact scope**: Only affects the displayed connection string in Studio UI. The per-instance Postgres itself continues to accept connections on both the internal `db:5432` path (within the Docker network) and the external `host.docker.internal:<portPostgres>` path (from Caddy).

---

## Decision 6: tls-ask.ts — No Change Required

**Decision**: `apps/api/src/routes/tls-ask.ts` does NOT need to be updated for Postgres routing.

**Rationale**: The `tls-ask.ts` route is the gate for Caddy's on-demand HTTP-01 cert issuance. With the wildcard cert (feature 004), `*.<apex>` is already covered — Caddy uses the loaded wildcard cert for `db.<ref>.<apex>` SNI without calling `tls-ask`. On-demand ACME is irrelevant for L4/TCP connections (Caddy never calls `tls-ask` for the `layer4` app; cert selection for L4 comes from the loaded certificates store).

**This is a deliberate simplification** vs. what the issue suggested. The issue mentioned updating `tls-ask.ts` as a defensive measure, but with the wildcard cert in place, `db.<ref>.<apex>` TLS just works via `tls_connection_policies` in the HTTP app and the wildcard cert tags in the L4 TLS handler.

---

## Decision 7: E2E Test Script (tests/cli-e2e/db-push.sh)

**Decision**: Create `tests/cli-e2e/db-push.sh` as a standalone E2E script covering all database CLI commands. Separate from `deploy-hello.sh` (functions-only) so database tests are independently runnable.

**Env vars**:
- `SELFBASE_APEX` — the apex domain
- `SELFBASE_PAT` — personal access token
- `SELFBASE_PROJECT_REF` — 20-char project ref
- `SELFBASE_DB_PASSWORD` — Postgres password (from instance secrets, needed for direct connection verification)

**Commands covered**:
1. `supabase db push` — apply a throwaway migration, assert exit 0
2. `supabase db pull` — dump current schema to a file
3. `supabase db diff` — diff against current schema (no pending migrations)
4. `supabase migration list` — list applied migrations
5. `supabase inspect db` — schema inspection

**Cleanup**: Roll back the throwaway migration after each run to keep the DB clean.

---

## Existing Code Integration Points

| File | Current state | Change needed |
|------|--------------|---------------|
| `apps/caddy/Dockerfile` | Does not exist | Create (xcaddy + caddy-l4) |
| `infra/docker-compose.yml` | `image: caddy:2.8-alpine` | Switch to build; add 5432 port |
| `apps/api/src/services/caddy-config.ts` | HTTP + TLS apps only | Add `layer4` app |
| `packages/docker-control/src/compose-template.ts` | `POSTGRES_HOST: 'db'` | `POSTGRES_HOST: db.<ref>.<apex>` |
| `apps/api/src/routes/tls-ask.ts` | No db.* patterns | No change needed |
| `tests/cli-e2e/db-push.sh` | Does not exist | Create |
| `docs/supabase-cli.md` | "db push requires --db-url" caveat | Remove caveat |
