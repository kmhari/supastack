# Research — Feature 009: Runtime config tunables

Decisions taken during /speckit-plan. All NEEDS-CLARIFICATION items from Technical Context are resolved here.

---

## R-001: Persistence model — JSONB snapshot vs read-from-`.env`-on-every-GET

**Decision**: Add a new control-plane table `project_config_snapshots` with one row per `(instance_ref, surface)` holding a JSONB blob of the full post-merge config. GET serves from this row. PATCH validates → merges → writes the row → writes `.env` → reloads container → on failure rolls back both `.env` and the row.

**Rationale**:
- GET must serve the full upstream shape (~234 fields for auth) — reading and parsing the per-instance `.env` on every GET would be slow and fragile (each provisioning template version writes a slightly different subset of vars).
- The Q4 clarification (full-shape parity, partial behavioral parity) means *we have a notion of persisted config that may not match the .env*. A separate JSONB snapshot is the only honest representation of that.
- The Q5 sentinel-merge rule (`***` means "leave secret unchanged") needs a place to look up "what's the current secret?" — the snapshot row holds the plaintext (encrypted at rest via the same `crypto` envelope used by `projectSecrets`) so the merge has something to merge against.
- Audit log diffs need before/after values; snapshot makes that trivial.

**Alternatives considered**:
- **Read `.env` on every GET, no snapshot table.** Rejected: makes the secret-sentinel round-trip impossible (we wouldn't know the existing OAuth secret value), and parsing `.env` is brittle.
- **Snapshot in Redis.** Rejected: needs to survive restart; auditability concerns; control-plane PG is the right home.

---

## R-002: Encryption at rest for the snapshot

**Decision**: The snapshot row stores `encrypted_payload bytea` — the full JSON config (including plaintext secrets) encrypted via the existing `@selfbase/crypto` envelope (`encryptJson` / `decryptJson(buf, loadMasterKey())`), same pattern as `projectSecrets.encryptedValue`.

**Rationale**: Plaintext secrets must round-trip safely through the sentinel-merge, so they need to be retrievable from the snapshot. The master-key envelope already exists, is audited, and never leaves the api container. Reusing it costs nothing.

**Alternatives considered**:
- **Plaintext JSONB.** Rejected: the `.env` is plaintext too, but it lives on each per-instance host and is protected by file perms; the control-plane DB is the wrong place for plaintext secrets.
- **Per-field encrypted columns.** Rejected: overkill, the surface is too wide.

---

## R-003: Container reload mechanism

**Decision**: Reuse `restartOrRollback` from `apps/api/src/services/secret-store.ts` verbatim — `docker restart <container>` followed by `waitContainerHealthy(name, 5000)`. Same `@selfbase/docker-control` adapter. New container names: `selfbase-${ref}-rest-1` (PostgREST) and `selfbase-${ref}-auth-1` (GoTrue).

**Rationale**:
- It already exists and works for the secrets endpoint, which has identical semantics ("write env → restart container → if unhealthy, rollback").
- `docker restart` (full container restart) is the only reliable signal that PostgREST + GoTrue pick up new env vars — neither responds to `SIGHUP` for env changes (env is read once at boot in their respective Go binaries).
- 30-second target in FR-002/FR-004 is well above the ~3-5s typical observed restart for these two containers on the production VM.

**Alternatives considered**:
- **`docker compose up -d --force-recreate <service>`.** Rejected: heavier (re-creates the container, not just restart), no advantage here.
- **`docker exec ... kill -HUP 1`.** Rejected: PostgREST and GoTrue don't reload env on SIGHUP.
- **Per-surface reload (only restart PostgREST when PATCHing postgrest config, only GoTrue when PATCHing auth config).** ✓ Adopted — the surface IS the container, so this is implicit.

---

## R-004: Cross-surface restart serialization

**Decision**: Per-project mutex via Redis SETNX on a key `selfbase:config-write-lock:<ref>` with a 60-second TTL. PATCH on either surface acquires the lock before any `.env` write; releases on success/failure. GET requires no lock.

**Rationale**:
- Two concurrent PATCHes to the same project — one on postgrest, one on auth — would each restart a different container, but each `.env` edit reads the file, mutates, and writes it back. Without serialization the second writer can race the first writer's `.env` write and lose its changes.
- The same `.env` file is shared between PostgREST and GoTrue via `env_file` (it's the per-instance `.env`, not per-container). So serialization MUST be per-project, not per-surface.
- Redis SETNX is already in use elsewhere in the codebase (`apps/api/src/services/`); no new dep.
- 60s TTL is well above the PATCH p95 budget (30s SC) and prevents stuck locks if the API crashes mid-flight.

**Alternatives considered**:
- **In-process mutex (`async-mutex`).** Rejected: api can be scaled horizontally; in-process locks won't serialize across instances.
- **PG advisory locks (`pg_advisory_xact_lock`).** Rejected: would work but adds a transaction surface for what is mostly file I/O. SETNX is simpler.
- **No locking — accept the race.** Rejected: spec Edge Case explicitly disallows it.

---

## R-005: RBAC enforcement point

**Decision**: Add 4 actions to `packages/shared/src/rbac.ts` `ACTIONS` tuple — `data_api_config.read`, `data_api_config.write`, `auth_config.read`, `auth_config.write`. Append rows to the `MATRIX` (admin: all true; member: read true, write false). Use the existing `app.authorize(req, '<action>')` in each route handler. The Q2 clarification fixed the action names to match upstream FGA permissions.

**Rationale**:
- Follows the established RBAC pattern from features 003 + 008.
- Member read access is consistent with `instance.read` / `pooler.read`.
- Members cannot mutate runtime config — same posture as `instance.update`.

**Alternatives considered**: see Q2 in spec — finer-grained per-surface naming chosen over single `project.config` action.

---

## R-006: Validation library

**Decision**: Zod schemas under `packages/shared/src/schemas/mgmt-api-{postgrest,auth}-config.ts`. Bounds are pulled from the upstream OpenAPI (`https://api.supabase.com/api/v1-json`) once at spec time and pinned as `z.number().int().min(N).max(M)` per field. Schema is the source of truth for validation; Fastify route uses `schema.parse(body)` and lets Zod's `ZodError` bubble to the `mgmt-api-errors.ts` envelope plugin (which already maps Zod errors to `{ error: { details: {...} } }`).

**Rationale**:
- Existing `mgmt-api-errors.ts` plugin already handles Zod errors with field-level detail — exactly what FR-005 requires.
- Pinning bounds at spec time avoids fetching the OpenAPI at runtime (network dep, version drift).
- A small unit test (`mgmt-api-config-validation.test.ts`) re-derives bounds from a local copy of the OpenAPI snapshot and asserts equality with the Zod schema — gives us a tripwire for upstream changes.

**Alternatives considered**:
- **AJV from a generated JSONSchema.** Rejected: adds a codegen step and a second validator. Zod is already the codebase convention.
- **No schema, hand-rolled validators.** Rejected: error envelope quality + 234-field auth surface make this untenable.

---

## R-007: Honored vs stored-only field mapping (auth-config)

**Decision**: Hand-maintained mapping table `env-field-mapper.ts` of shape:

```ts
type FieldMapping =
  | { kind: 'honored'; envName: string; transform?: (v: unknown) => string }
  | { kind: 'stored_only' };

const AUTH_CONFIG_MAP: Record<string, FieldMapping> = {
  jwt_exp: { kind: 'honored', envName: 'JWT_EXPIRY' },
  site_url: { kind: 'honored', envName: 'SITE_URL' },
  uri_allow_list: { kind: 'honored', envName: 'ADDITIONAL_REDIRECT_URLS' },
  disable_signup: { kind: 'honored', envName: 'DISABLE_SIGNUP' },
  // ...22 OAuth provider triples...
  external_google_enabled: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_GOOGLE_ENABLED' },
  external_google_client_id: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID' },
  external_google_secret: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_GOOGLE_SECRET' },
  // ...
  hook_custom_access_token_uri: { kind: 'stored_only' }, // tracked in #21
  saml_external_url: { kind: 'stored_only' },           // tracked in #21
  security_captcha_provider: { kind: 'stored_only' },   // tracked in #21
  // ...
};
```

PATCH iterates the merged config; only `honored` entries get written to `.env`; `stored_only` entries persist in the snapshot only.

**Rationale**:
- Matches the per-instance template's actual env wiring (verified by `grep "GOTRUE_\|PGRST_" infra/supabase-template/docker-compose.yml`).
- Explicit `stored_only` markers make the gap discoverable for issue #21 cleanup.
- Pure function → easy to unit test (`env-field-mapper.test.ts` asserts every upstream field is either honored with a known env var or marked stored_only — no silent drops).

**Alternatives considered**:
- **Derive mapping from `docker-compose.yml` at runtime.** Rejected: too fragile, slow, and the mapping isn't 1:1 (e.g. `uri_allow_list` → `ADDITIONAL_REDIRECT_URLS`, `jwt_exp` → `JWT_EXPIRY`).
- **Single hardcoded mapping in the route handler.** Rejected: not testable in isolation.

---

## R-008: Secret redaction sentinel

**Decision**: Use the literal three-character string `***` as the redaction sentinel in GET responses for every secret-typed field, and as the "leave unchanged" marker accepted on PATCH (Q5). Constant exported from `packages/shared/src/schemas/mgmt-api-auth-config.ts` as `REDACTED_SECRET = '***'`. The list of secret-typed field names is also exported as `SECRET_FIELDS: Set<string>`.

**Rationale**:
- Matches what the upstream `supabase` CLI displays today (verified by inspecting CLI output against api.supabase.com).
- Three characters is short enough to be visually obvious in CLI output and unlikely to collide with a real secret (no legitimate OAuth secret is `***`).
- Centralizing in one constant lets the unit test, integration test, and runtime all reference the same source of truth.

**Alternatives considered**:
- **Omit secret fields entirely from GET.** Rejected: breaks the round-trip — CLI does `get → modify → patch full body`; if the secret is omitted, patching won't preserve it (it would set the field to undefined → upstream Cloud treats undefined as "leave unchanged" too, but the round-trip is harder to reason about).
- **Per-secret-typed hash.** Rejected: introduces complexity for no real win.

---

## R-009: Migration idempotency

**Decision**: New migration `packages/db/migrations/0009_project_config_snapshots.sql` uses `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, and `ADD CONSTRAINT IF NOT EXISTS` patterns. No data migration needed (table starts empty; rows lazy-created on first PATCH).

**Rationale**: Repo-wide convention from CLAUDE.md ("Migrations are idempotent. Every `packages/db/migrations/*.sql` uses IF NOT EXISTS… Re-running the whole sequence must be a no-op.").

---

## R-010: CLI version pinning for the e2e script

**Decision**: Pin to `supabase` CLI v2.41.0 (current stable at feature start). Recorded as a comment at the top of `tests/cli-e2e/postgres-config-and-auth-config.sh`:

```sh
# Validated against supabase CLI v2.41.0 (2026-05).
# If the CLI version drifts and flag names change, this script catches it.
SUPABASE_CLI_VERSION_PIN="v2.41.0"
supabase --version | grep -q "${SUPABASE_CLI_VERSION_PIN#v}" || {
  echo "FAIL: CLI version mismatch — script validated against ${SUPABASE_CLI_VERSION_PIN}." >&2
  echo "      Re-validate the script against the new CLI version, update the pin," >&2
  echo "      and document any flag/response shape drift before removing this gate." >&2
  exit 1
}
```

**Rationale**: FR-013 mandates that CLI drift is "caught by the test rather than silently passing." A non-zero exit is the only behavior consistent with that wording. Treat CLI upgrades as a deliberate test-update PR, not a silent CI passthrough.

---

## Open questions (none blocking)

None. All Phase 0 decisions resolved.
