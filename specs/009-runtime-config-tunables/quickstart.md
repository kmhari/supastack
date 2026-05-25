# Quickstart — Feature 009: Runtime config tunables

End-to-end walkthrough for operators and developers. Assumes a selfbase install with at least one running project (`<ref>`) and a Personal Access Token (`<pat>`).

## Operator walkthrough — extend JWT expiry to 24h

```bash
# Configure the upstream supabase CLI to point at selfbase.
export SUPABASE_ACCESS_TOKEN=<pat>
export SUPABASE_INTERNAL_API_URL=https://api.<your-apex>

# Inspect current auth config (jwt_exp will be 3600 by default).
supabase config get --project-ref <ref> | jq .jwt_exp

# Extend to 24 hours.
supabase config update --project-ref <ref> --auth-jwt-expiry 86400

# Re-fetch — should now show 86400.
supabase config get --project-ref <ref> | jq .jwt_exp

# Sign in any user against the project's auth endpoint and decode the JWT:
#   exp - iat ≈ 86400  (±60s for container restart timing)
```

Pre-existing sessions keep working until their original `exp` — no forced sign-outs.

## Operator walkthrough — expose a custom Postgres schema through PostgREST

```bash
supabase postgres-config get --project-ref <ref> | jq .db_schema
# → "public"

supabase postgres-config update --project-ref <ref> --db-schema "public,app_v2"

# Within ~30 seconds, calls to /rest/v1/app_v2.<table> stop returning 404.
curl https://<ref>.<your-apex>/rest/v1/app_v2.my_table \
  -H "apikey: <anon-key>" \
  -H "Authorization: Bearer <jwt>"
```

## Developer walkthrough — add a new honored field

If a downstream change adds a new GoTrue env var to `infra/supabase-template/docker-compose.yml`, expose it through this endpoint:

1. Find the field in upstream `https://api.supabase.com/api/v1-json` under `UpdateAuthConfigBody.properties`.
2. Add a Zod entry in `packages/shared/src/schemas/mgmt-api-auth-config.ts` matching upstream's bounds.
3. Add a mapping in `apps/api/src/services/env-field-mapper.ts::AUTH_CONFIG_MAP`:
   ```ts
   <upstream_field_name>: { kind: 'honored', envName: '<GOTRUE_ENV_NAME>' },
   ```
4. Add a unit test case in `env-field-mapper.test.ts` covering the new field.
5. (If non-trivial mapping) add a transform fn in the mapping entry.

No migration needed — the snapshot JSONB absorbs new keys automatically.

## Developer walkthrough — promoting a stored-only field to honored

Tracked centrally in **issue #21**. Per field:

1. Verify the GoTrue (or downstream container) version we ship actually supports the env var.
2. Wire the env var in `infra/supabase-template/docker-compose.yml`.
3. Flip the mapping from `{ kind: 'stored_only' }` to `{ kind: 'honored', envName: '<NAME>' }`.
4. Existing snapshot rows already carry the value — first PATCH (or a re-PATCH with the existing value) will write it into `.env` and the container will pick it up on next restart.

## Running the live CLI smoke test

```bash
# From repo root. Targets the production VM by default; override SELFBASE_HOST for staging.
SELFBASE_HOST=https://api.supaviser.dev \
SELFBASE_PAT=<pat> \
SELFBASE_REF=<ref> \
  bash tests/cli-e2e/postgres-config-and-auth-config.sh
```

The script:
1. Verifies `supabase` CLI version against the pin (warns on mismatch).
2. `postgres-config get` → asserts default fields present.
3. `postgres-config update --max-rows 5000` → re-`get` → asserts persisted.
4. `postgres-config update --max-rows -1` → asserts exit non-zero + per-field error.
5. `config get` (auth) → asserts default `jwt_exp`.
6. `config update --auth-jwt-expiry 7200` → re-`get` → asserts persisted.
7. `config update --auth-jwt-expiry 99999999` → asserts exit non-zero (bound violated).
8. Restores both surfaces to pre-test values.

Exit 0 means the contract is intact.

## Rollback scenario (FR-007 + SC-006)

If a PATCH causes the per-instance container to fail to restart (e.g. a malformed `uri_allow_list` that passes our shape validation but GoTrue rejects on boot):

- The API returns `500 restart_failed`.
- The `.env` is restored from the backup taken before the write.
- The snapshot row is reverted to its prior value.
- The container is restarted on the prior config — comes back healthy within 60s.
- A subsequent `GET` reflects the prior (not the rejected) config.

To verify rollback after a real production incident: tail the container's restart count in Docker and the `audit_log` for a `mgmt_api.<surface>.update` entry — the audit entry is emitted only on successful PATCH, so a 500 leaves no audit entry; the rejected attempt is logged via the standard structured-logger pipeline instead.
