# Contract — `/v1/projects/<ref>/postgrest`

Mirrors upstream Supabase Management API. Source: `https://api.supabase.com/api/v1-json` operations `v1-get-postgrest-service-config` and `v1-update-postgrest-service-config`.

## `GET /v1/projects/<ref>/postgrest`

**Auth**: PAT bearer; RBAC action `data_api_config.read`.

**Response 200** (`application/json`):

```json
{
  "db_schema": "public",
  "db_extra_search_path": "public,extensions",
  "max_rows": 1000,
  "db_pool": null
}
```

All four fields are required in the response. `db_pool: null` means "auto-configured" (supastack always returns `null` unless an operator explicitly set it). Returned values come from the persisted `project_config_snapshots` row for `(ref, 'postgrest')`, or upstream-documented defaults if no row exists yet.

**Note**: upstream's `PostgrestConfigWithJWTSecretResponse` includes a `jwt_secret` field. Supastack explicitly does NOT return `jwt_secret` from this endpoint — the JWT signing secret is platform-managed (see spec Assumptions, JWT rotation is out of scope). Clients that expect this field will see it missing; the upstream OpenAPI shape uses two separate response schemas (`PostgrestConfigWithJWTSecretResponse` for GET, `V1PostgrestConfigResponse` for PATCH-response) — we return the PATCH-response shape on both, matching upstream's documented PATCH return.

**Error responses**:
- `401 unauthorized` — invalid/missing PAT.
- `403 forbidden_action` — PAT lacks `data_api_config.read`.
- `404 not_found` — `<ref>` is not a known project.
- `409 project_not_running` — project exists but is paused/error state.

## `PATCH /v1/projects/<ref>/postgrest`

**Auth**: PAT bearer; RBAC action `data_api_config.write`.

**Request body** (`application/json`, all fields optional):

```json
{
  "db_schema": "public,storage",
  "db_extra_search_path": "public,extensions",
  "max_rows": 5000,
  "db_pool": 20
}
```

**Validation** (Zod schema in `packages/shared/src/schemas/mgmt-api-postgrest-config.ts`):

| Field | Type | Bounds |
|---|---|---|
| `db_schema` | string | non-empty if present |
| `db_extra_search_path` | string | (no bounds) |
| `max_rows` | integer | 0–1,000,000 (per upstream OpenAPI) |
| `db_pool` | integer \| null | 0–1,000 or null |

Any field not listed above → 400 `validation_failed` with `error.details.<field> = "unknown_field"`.

**Response 200**: identical shape to GET response, returning the post-merge config (every field present, even ones the caller did not include in the PATCH body — they retain their prior value).

**Side effects**:
1. Acquire Redis lock `supastack:config-write-lock:<ref>` (TTL 60s). If already held → 409 `config_write_in_progress`.
2. Validate body via Zod → 400 on any field error.
3. Read current snapshot (or defaults if none).
4. Merge body over current → post-merge JSON.
5. For honored fields: rewrite the per-instance `.env` via `upsertEnvEntry`.
6. Persist new snapshot row (INSERT or UPDATE), bumping `version`.
7. `docker restart supastack-<ref>-rest-1` → `waitContainerHealthy(5000)`.
8. On any failure after step 5: roll back `.env` from backup, delete or revert the snapshot row, return 500 `restart_failed`.
9. Emit `audit_log` entry with `action='mgmt_api.postgrest.update'` and the field-level diff.
10. Release Redis lock.

**Error responses**:
- `400 validation_failed` — see Validation table above.
- `401 unauthorized` / `403 forbidden_action` / `404 not_found` / `409 project_not_running` — as for GET.
- `409 config_write_in_progress` — another PATCH on this project is in flight.
- `500 restart_failed` — container did not come back healthy; rollback completed; GET reflects pre-PATCH state.

## CLI invocations covered

```bash
supabase postgres-config get --project-ref <ref>
supabase postgres-config update --project-ref <ref> --db-schema "public,app_v2"
supabase postgres-config update --project-ref <ref> --max-rows 5000
supabase postgres-config update --project-ref <ref> --db-pool 20
```

All of the above MUST resolve `<ref>` against `https://api.<apex>` (supastack) when the CLI is configured for supastack via `supabase login --workdir <supastack-pat>`.
