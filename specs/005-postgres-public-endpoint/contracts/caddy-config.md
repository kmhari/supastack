# Contract: buildCaddyConfig() Output — Layer4 Extension

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23

This contract defines the incremental change to the output of `buildCaddyConfig()` in
`apps/api/src/services/caddy-config.ts`.

---

## Preconditions for Layer4 Emission

The `layer4` app block is included in the Caddy config **only when both**:
1. `org.apexDomain` is non-null (apex configured)
2. A `wildcard_certs` row exists with `status = 'issued'` (wildcard cert active)

When either precondition fails, the `layer4` key is omitted entirely and the config is identical
to the feature 004 output.

---

## Layer4 Block Contract

```json
"layer4": {
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
                // One entry per active (non-deleting) instance, in any order:
                {
                  "match": [{ "tls": { "sni": ["db.{ref}.{apex}"] } }],
                  "handle": [
                    { "handler": "tls" },
                    {
                      "handler": "proxy",
                      "upstreams": [{ "dial": "host.docker.internal:{portPostgres}" }]
                    }
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
```

Where:
- `{ref}` — the 20-char instance ref from `supabase_instances.ref`
- `{apex}` — the org's apex domain from `org.apex_domain`
- `{portPostgres}` — the host port from `supabase_instances.port_postgres`

---

## Instance Query

Same query as used for HTTP routes — excludes `status = 'deleting'`:

```ts
const instances = await db()
  .select({ ref: schema.supabaseInstances.ref, portPostgres: schema.supabaseInstances.portPostgres })
  .from(schema.supabaseInstances)
  .where(not(inArray(schema.supabaseInstances.status, ['deleting'])));
```

---

## Zero-Instance Case

When `instances` is empty (no provisioned projects): the `routes` array inside `subroute` is
empty `[]`. Caddy accepts this (no routes = no connections matched). The `:5432` listener is
still active but no connections succeed (all get reset). This is correct — there's nothing to
route to.

---

## Backward Compatibility Invariant

The `tls` and `http` app blocks are unchanged. A Caddy config without `layer4` (all existing
deployments before this feature) is functionally identical to a config with `layer4: {}` (empty
— no servers). Caddy treats the missing key and the empty object identically.

Verification: the existing unit test for `buildCaddyConfig()` with no wildcard cert must still
pass and assert no `layer4` key in the output.
