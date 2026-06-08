# Contract — `GET /api/v1/wildcard-certs/status` `allDnsReady` signal

Unauthenticated first-install endpoint polled by the setup wizard. This feature changes **how `cert.allDnsReady` is computed**; the response shape is unchanged.

## Response (unchanged shape)

```jsonc
{
  "cert": {
    // …existing fields (status, expiresAt, …)
    "challengeRecords": [ { "name": "_acme-challenge.apex", "value": "<txt>" }, … ],
    "dnsChecks":        [ { "name": "_acme-challenge.apex", "value": "<txt>", "found": true }, … ],
    "allDnsReady":      true            // ← the authoritative gate signal
  }
}
// cert may be null (no order yet) → allDnsReady absent → gate stays closed.
```

## `allDnsReady` semantics (the contract under test)

`allDnsReady` is `true` **iff** there is at least one challenge record **and every** challenge record is found by the public resolvers:

```
allDnsReady = dnsChecks.length > 0 && dnsChecks.every(c => c.found)
```

| `challengeRecords` | `dnsChecks` | `allDnsReady` | Note |
|---|---|---|---|
| none / `[]` | `[]` | **`false`** | FR-002 — never vacuously ready (was `true` via `[].every()`) |
| present, none found | all `found:false` | `false` | waiting for propagation |
| present, some found | mixed | `false` | partial |
| present, all found | all `found:true` | `true` | gate may open (with apex+wildcard A also ok) |
| no order exists | — (cert `null`) | absent | gate closed (consumer `?? false`) |

## Consumer contract (wizard)

- The wizard's gate MUST be `apexDnsOk && wildcardDnsOk && (cert.allDnsReady ?? false)` — it MUST NOT re-derive readiness by recounting `dnsChecks`/`challengeRecords` client-side.
- The wizard MUST NOT issue any browser-side DNS or apex HTTP lookup to compute readiness (FR-007).

## Tests

- **Backend unit** (`apps/api/tests/unit`): `allDnsReady` is `false` for empty `dnsChecks`, `false` for any unfound, `true` only when non-empty and all found.
- **Frontend unit** (`apps/web/tests/unit`): gate is closed when `allDnsReady` is `false`/`undefined`/absent even if A-records ok; open only when A-records ok AND `allDnsReady === true`; no reference to `allTxtFound` remains.
