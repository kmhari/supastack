# Contract: Management API auth-config — MUST NOT REGRESS

This is the **pinned** Supabase-compatible surface (Constitution IV). This feature MUST leave it byte-for-byte unchanged. Listed here so the no-regression requirement (FR-005 / SC-005) is an explicit, testable contract.

## `GET /v1/projects/:ref/config/auth` (host `api.<apex>`)

- Request/response field names stay **lowercase snake_case** (`external_github_enabled`, `site_url`, …).
- Response continues to include the `_supastack.fieldStatus` extension exactly as today.
- Status codes, masking, and shape unchanged.

## `PATCH /v1/projects/:ref/config/auth`

- Body validated by the existing `.strict()` `UpdateAuthConfigBodySchema` — **lowercase** keys only.
- An UPPERCASE key here still → **400 unknown_field** (the CLI never sends uppercase; only the platform bridge translates). This is intentional and preserved.
- `ManagementApiError` envelope (`{ error: { code, message, details } }`) and status codes unchanged.

## Guardrails

- **No edits** to `apps/api/src/routes/management/auth-config.ts`, `runtime-config-store.ts` validation, or `packages/shared/src/mgmt-api-schemas.ts` `UpdateAuthConfigBodySchema`.
- The existing `auth-config-response-shape.test.ts` + the upstream-OpenAPI snapshot test pass unchanged.
- The CLI E2E path (lowercase config push) is unaffected.

**Acceptance**: the full pre-existing `/v1` auth-config test suite passes with zero diffs after this feature.
