# Data Model: Postgres Public Endpoint via SNI Routing

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23

---

## No New DB Tables

This feature introduces no new database tables or migrations. All routing state is derived at runtime from existing tables.

---

## Existing Entities Used

### supabase_instances (existing — read-only for this feature)

The `portPostgres` column (already present) is the only addition needed from feature data — it was added in the original platform implementation. No schema migration required.

| Column | Type | Use in this feature |
|--------|------|---------------------|
| `ref` | `text` (20 chars) | Forms the SNI hostname `db.<ref>.<apex>` |
| `portPostgres` | `integer` | The L4 upstream dial target `host.docker.internal:<portPostgres>` |
| `status` | `text` | Routes only emitted for non-`deleting` instances (same filter as HTTP routes) |

---

## Derived / Ephemeral Entities

### L4 Route Entry (ephemeral — not persisted)

Built in memory inside `buildCaddyConfig()` and POSTed to Caddy admin `/load`. Discarded immediately after reload. The source of truth is always the DB.

```ts
interface L4RouteEntry {
  sni: string;              // e.g., "db.abcdefghijklmnopqrst.selfbase.example.com"
  upstream: string;         // e.g., "host.docker.internal:32000"
}
```

Derived as:
```ts
const l4Routes = instances.map(i => ({
  sni: `db.${i.ref}.${apex}`,
  upstream: `host.docker.internal:${i.portPostgres}`,
}));
```

### ComposeTemplateInputs.apex (existing — already in type)

The `apex` field in `ComposeTemplateInputs` (in `packages/docker-control/src/compose-template.ts`) is already present and required. The change is how `POSTGRES_HOST` is derived from it:

```ts
// Before:
POSTGRES_HOST: 'db'

// After:
POSTGRES_HOST: apex ? `db.${ref}.${apex}` : 'db'
```

No type changes needed — `apex` is already a required `string` in `ComposeTemplateInputs`.

---

## Config Shape Delta

The only "stored" artifact is the Caddy JSON config sent to the admin API. Here is the shape delta from feature 004's config:

**New top-level key in the Caddy JSON** (when wildcard cert is active):

```json
{
  "apps": {
    "tls": { ... },
    "http": { ... },
    "layer4": {           // ← NEW
      "servers": {
        "postgres": {
          "listen": [":5432"],
          "routes": [
            {
              "match": [{ "postgres": {} }],
              "handle": [
                { "handler": "postgres" },
                {
                  "handler": "subroute",
                  "routes": [
                    // One entry per active non-deleting instance:
                    {
                      "match": [{ "tls": { "sni": ["db.<ref>.<apex>"] } }],
                      "handle": [
                        { "handler": "tls" },
                        { "handler": "proxy",
                          "upstreams": [{ "dial": "host.docker.internal:<portPostgres>" }] }
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

When no wildcard cert or no apex: the `layer4` key is absent entirely (backward compat).

---

## Test Script Interface

### tests/cli-e2e/db-push.sh

Required environment variables:

| Variable | Description |
|---|---|
| `SELFBASE_APEX` | Apex domain (e.g. `selfbase.example.com`) |
| `SELFBASE_PAT` | Personal access token for supabase CLI auth |
| `SELFBASE_PROJECT_REF` | 20-char project ref |
| `SELFBASE_DB_PASSWORD` | Postgres password (from instance secrets) |

Optional:

| Variable | Default | Description |
|---|---|---|
| `SELFBASE_ANON_KEY` | `fake` | Anon JWT for REST smoke test |

Outputs: exit 0 on all commands passing, exit 1 with a `FAIL:` message on any failure.
