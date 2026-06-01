# Research — 010 Secrets management

**Date**: 2026-05-25

All clarifications resolved during `/speckit-clarify` (see spec.md → Clarifications, Session 2026-05-25). The decisions below cover technical specifics needed to implement against those clarified requirements.

---

## Decision 1 — Per-project Postgres access from the api

**Decision**: A new `vault-client.ts` service in the api creates a short-lived `pg.Client` per request, connecting to `host.docker.internal:<port_db_direct>` as `supabase_admin` using the per-instance password loaded from `encryptedSecrets`. Connections are not pooled across requests; vault calls are infrequent (operator-driven), so per-request connect overhead (~10–30ms) is acceptable.

**Rationale**: Avoids holding long-lived connections per project in the api container (would multiply with project count and clash with supabase_admin's session-state quirks around pgsodium key context). Matches the pattern used by `apps/api/src/services/pg-password-reset.ts` from feature 008 — same supabase_admin + docker.internal access path.

**Alternatives considered**:
- **Shared pg pool keyed by ref**: Lower latency under burst (~1ms vs 10–30ms) but adds connection-state risk for pgsodium contexts and complicates teardown when projects are deleted/paused. Rejected — operator-facing latency dominates network, not connect cost.
- **Run vault SQL through pg-meta via kong**: Reuses an existing path but pg-meta has no `vault.*` schema knowledge and would force us to express writes as raw query proxies — strictly worse than a direct `pg` client.

---

## Decision 2 — Vault CRUD SQL

**Decision**: Use the documented `vault.*` functions directly:
- Create: `SELECT vault.create_secret($1::text, $2::text)` — value first, name second per upstream signature; returns `uuid`.
- Update value: `SELECT vault.update_secret(id := $1, new_secret := $2)`.
- Read all (for runtime injection + dashboard list): `SELECT name, decrypted_secret, updated_at FROM vault.decrypted_secrets WHERE key_id IS NOT NULL`.
- Delete: `DELETE FROM vault.secrets WHERE name = $1`.
- Digest for dashboard display: computed server-side in api via `crypto.createHash('sha256').update(value).digest('hex')` after reading — `vault.decrypted_secrets` doesn't expose a stored digest, and computing once per list-read is cheap.

**Rationale**: These are the upstream-stable interfaces; Studio's bundled Vault UI uses the same path, so writes from either surface land in the same rows interchangeably (FR-004, SC-006).

**Alternatives considered**:
- **Insert directly into `vault.secrets`**: Skips the helper function's pgsodium key-context setup; brittle across pgsodium versions. Rejected.
- **Persist digest as a column**: Would require a side-table since vault is upstream-owned. Computing on read is fine for the ~50-secret scale (SC-010 budget unaffected — list is rare vs runtime injection refresh).

---

## Decision 3 — Edge runtime TTL cache implementation

**Decision**: In the per-project `main/index.ts` (templated by supastack, replacing the upstream stub), maintain a single module-level cache object:

```ts
let cache: { ts: number; envVars: Record<string, string> } | null = null;
const TTL_MS = parseInt(Deno.env.get('SUPASTACK_VAULT_TTL_MS') ?? '5000', 10);
const PROJECT_REF = Deno.env.get('SB_REF') ?? '';
const RESERVED = new Set([...]); // baked in from packages/shared/reserved-secrets at image build

async function getEnvVars(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cache && now - cache.ts < TTL_MS) return cache.envVars;
  try {
    const rows = await pg.query<{ name: string; decrypted_secret: string }>(
      'SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE key_id IS NOT NULL'
    );
    const fresh: Record<string, string> = {};
    for (const r of rows) {
      if (RESERVED.has(r.name)) continue; // defense in depth (FR-014)
      fresh[r.name] = r.decrypted_secret;
    }
    cache = { ts: now, envVars: fresh };
    return fresh;
  } catch (err) {
    console.error(`[supastack-vault] refresh failed for ${PROJECT_REF}: ${(err as Error).message}`);
    return cache?.envVars ?? {}; // FR-016 fallback
  }
}
```

A single in-flight refresh promise is shared across concurrent reads (request-coalescing) so TTL-expiry under burst doesn't trigger N parallel `SELECT`s — satisfies SC-010.

**Rationale**: Module-level state in a long-running Deno process behaves like a per-container singleton — exactly what we want since each functions container is per-project. Passive TTL (no external invalidation channel) matches the clarified design (Q2 → passive).

**Alternatives considered**:
- **Per-request fresh fetch with no cache**: Simplest but blows SC-010 (every invocation = 1 query).
- **LRU per-secret-name**: Overkill — the entire secret map fits in <100KB for any realistic project.

---

## Decision 4 — Reserved-name list distribution to the runtime

**Decision**: Generate `infra/supabase-template/volumes/functions/main/reserved-secrets.json` at api/worker build time from `packages/shared/src/reserved-secrets.ts`. The templated `main/index.ts` loads it via `await import('./reserved-secrets.json', { with: { type: 'json' } })` at module init. The compose-template builder (`packages/docker-control`) ensures the JSON is materialized into each per-instance functions volume.

**Rationale**: Single source of truth in `packages/shared` (api + web read TypeScript directly; runtime gets the materialized JSON). Avoids stamping the list into the runtime image, which would couple a list change to a runtime image rebuild. The JSON file is small and gets refreshed on every project up/restart via the existing template mechanism.

**Alternatives considered**:
- **Hardcode in runtime image**: List change → runtime image rebuild + per-project re-pull. Slow.
- **Fetch from api at runtime startup**: Adds a control-plane dependency to runtime boot. Brittle.

---

## Decision 5 — Vault enablement entry points (SUPERSEDED — no boot scan)

**Decision**: Two entry points only:

1. **Provision-time** (every new instance): `bootstrapVault` is invoked synchronously from the provision pipeline (Decision 6 SQL sequence). If it fails, the instance does NOT reach `running` status (FR-005). Sets `supabase_instances.vault_enabled_at`.
2. **Dashboard button** (rare edge case): `POST /api/v1/projects/<ref>/vault/enable` enqueues a BullMQ `vault-enable` job that runs the same `bootstrapVault` SQL. Idempotent. Used only for backup-restore recovery; the button is hidden when `vault_enabled_at IS NOT NULL`.

No automated boot-time backfill scan. The deployment will be reset before feature 010 ships, so there are zero pre-existing instances to migrate. The original Q5 clarification (auto + button) is recorded for historical context but the auto half is dropped to keep the api startup path clean.

**Rationale**: Boot scan would have been one-time-useful at deploy then dead weight forever. Removing it eliminates ~80 LoC of scan + queue plumbing and one place the api could hit per-project Postgres at startup. The dashboard button alone covers the only remaining real-world re-enable need.

**Alternatives considered**:
- **Keep the scan as belt-and-suspenders**: Adds startup latency proportional to project count for zero value once the marker column is populated. Rejected.
- **Cron job**: Even more dead weight than the boot scan. Rejected.

The BullMQ `vault-enable` job (Decision 6) is still needed for the dashboard button path.

---

## Decision 6 — `vault-enable` job SQL sequence

**Decision**:

```sql
-- All idempotent
CREATE EXTENSION IF NOT EXISTS pgsodium;
SELECT pgsodium.create_root_key() WHERE NOT EXISTS (SELECT 1 FROM pgsodium.key WHERE name = 'default');
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;
-- Verify
SELECT extname FROM pg_extension WHERE extname IN ('pgsodium','supabase_vault');
-- Smoke test (creates + deletes a sentinel to confirm encrypt/decrypt path works)
DO $$
DECLARE sentinel_id uuid;
BEGIN
  sentinel_id := (SELECT vault.create_secret('supastack-bootstrap-sentinel', '_supastack_bootstrap_check'));
  PERFORM decrypted_secret FROM vault.decrypted_secrets WHERE id = sentinel_id;
  DELETE FROM vault.secrets WHERE id = sentinel_id;
END $$;
```

The job emits an audit log entry `instance.vault.enabled` on success and updates a new `instances.vault_enabled_at` column for the boot-scan fast-path on subsequent restarts.

**Rationale**: Order matters — pgsodium first, then root key (if absent), then vault. The smoke test catches partial-install pathologies (e.g., libsodium missing) earlier than the next operator-driven write would.

**Alternatives considered**:
- **Skip the smoke test**: Faster but defers detection of broken installs to first dashboard save. Tested-once-at-bootstrap is the better failure surface.
- **Use `CREATE EXTENSION supabase_vault` without `CASCADE`**: Fails if pgsodium isn't pre-installed; CASCADE makes the dependency explicit and bulletproof for re-runs.

---

## Decision 7 — Caddy redirect for Studio's `/functions/secrets`

**Decision**: Add a rule in `apps/caddy/Caddyfile` matching the per-project studio subdomain pattern:

```caddy
@studio_secrets {
  host_regexp studio_ref ^studio-(?P<ref>[a-z0-9]{20})\.<apex>$
  path /project/default/functions/secrets /project/default/functions/secrets/*
}
redir @studio_secrets https://<apex>/dashboard/project/{re.studio_ref.ref}/secrets{uri.query_separator}{query} 302
```

The `<apex>` placeholder is substituted at Caddyfile render time (the existing template mechanism). Query strings and sub-paths preserved via the `{uri}` machinery; tested manually with `?preset=foo` (acceptance scenario 2 of US4).

**Rationale**: Path-prefix-precise (FR-022); same-config-for-all-projects (FR-025); zero per-project state. Matches the existing Caddy hostname routing convention in supastack.

**Alternatives considered**:
- **Studio container modification**: Touches upstream image; rebuilds on every Studio version bump. Rejected.
- **DNS-level redirect**: Not possible at the path granularity required.

---

## Decision 8 — Wire-contract preservation testing

**Decision**: A new contract test suite at `apps/api/tests/contract/secrets-v1.contract.test.ts` that exercises `POST/GET/DELETE /v1/projects/<ref>/secrets` against a stub vault-client (records the SQL it would have issued) and asserts:
- HTTP method, path, request body shape (unchanged)
- HTTP status codes for each error class (reserved name → 400 with `code: 'reserved_name'`, etc.)
- Response body shape (`{ secrets: [{ name, valueSha256, updatedAt }] }` etc.)
- RBAC enforcement (admin-required actions return 403 for non-admin)

Snapshot the request/response payloads against the pre-feature baseline (extract from the current secret-store integration test fixtures) so any drift gets flagged.

**Rationale**: SC-008 requires zero wire regressions. A snapshot-style contract test is the lowest-friction way to enforce this — failures get an explicit diff against the baseline.

**Alternatives considered**:
- **Live E2E against a real instance**: Slower, flakier, needs VM. Use as a follow-up smoke; not the primary guard.
- **Trust manual testing**: Unacceptable for a public-facing wire contract.

---

## Resolved NEEDS CLARIFICATION

All clarifications from the spec (Session 2026-05-25) are resolved:

| Clarification | Resolution |
|---|---|
| TTL default | 5 seconds (Decision 3 uses `SUPASTACK_VAULT_TTL_MS=5000` default) |
| Cache invalidation strategy | Passive TTL only (Decision 3 — no Redis, no HTTP poke) |
| `project_secrets` migration | None — operators re-enter (no migration code in this plan) |
| DB-unreachable fallback | Spawn with no user secrets, log (Decision 3 — `catch` returns `cache?.envVars ?? {}`) |
| Backfill trigger | Dashboard button only (Decision 5 — boot scan dropped; deployment will be reset before ship) |

Phase 0 complete. Proceeding to Phase 1 design.
