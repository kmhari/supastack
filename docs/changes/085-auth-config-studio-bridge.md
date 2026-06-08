# Feature 085 — Auth Config (GoTrue settings per project) Studio parity

**Status**: Implemented + deployed to `supaviser.dev` (2026-06-03). 14 unit tests + live E2E 10/10.

## Problem

Studio (`IS_PLATFORM=true`) reads/writes per-project auth config via `GET/PATCH /platform/auth/:ref/config` using **UPPERCASE** GoTrue-config field names (`EXTERNAL_GITHUB_ENABLED`). The platform bridge re-injected that body/response verbatim to the Management API `/v1/projects/:ref/config/auth`, whose schema is `.strict()` **lowercase** (`external_github_enabled`) → PATCH `400 unknown_field` (masked as a generic **500 "internal error"**); GET returned lowercase keys Studio couldn't read. Result: no project's auth could be configured from the dashboard.

## Fix

- **`apps/api/src/services/auth-config-case.ts`** (new, pure): `toApiKeys` / `toStudioKeys` — a clean bidirectional **case-flip** over `ALL_AUTH_CONFIG_FIELDS` (the schema's key set; the mapper `envName` is NOT a usable bridge: `jwt_exp→JWT_EXPIRY`, `uri_allow_list→ADDITIONAL_REDIRECT_URLS`). `_supastack` meta excluded; unknown keys pass through so the strict schema still reports them. Alias table empty (exhaustively verified — all 234 fields round-trip).
- **`apps/api/src/routes/platform-misc.ts`** (bridge): GET translates the response, PATCH translates the request; both re-inject via **`/v1`** (not `/api/v1`) so the `ManagementApiError` envelope surfaces **400 + details** instead of 500. `details` keys are translated back to the Studio (uppercase) space. New **`GET/PATCH /platform/auth/:ref/config/hooks`** — a scoped view/write over the `hook_*` subset (routes through `patchConfig('auth')`, reusing feature 082 `pg-functions://` validation + the `/v1` RBAC `auth_config.read/write`).
- **Untouched**: the Management API `/v1` schema, handler, and snapshot (Constitution IV). No migration, no new dependency.

## Why route via `/v1`

`authConfigRoutes` is mounted **both** at `/api/v1` (generic 500 error handler — what the bridge hit before) and inside the `/v1` scope (with `mgmtApiErrorsPlugin` → proper 400 + `details`). Re-injecting to `/v1` fixes the error masking for free; the success response is identical (same handler).

## Verification

- Unit: `apps/api/tests/unit/auth-config-{case,bridge,hooks}.test.ts` — 14 tests (incl. an exhaustive 234-field round-trip + `_supastack` meta passthrough + unknown-field passthrough). The `/v1` no-regression test (`auth-config-response-shape.test.ts`) passes unchanged.
- Live (`tests/cli-e2e/auth-config-studio.sh`, project `tbnqljlgozpxzhkjxats`): **10/10** — uppercase PATCH→200, GET uppercase (no top-level lowercase leak), invalid→400 naming the field (not 500), hooks GET/PATCH round-trip, `/v1` lowercase no-regression. Provider confirmed enabled on the instance GoTrue after reload, then reset.

## Notes

- GoTrue exposes no config-write API (verified: `/admin/config` 404) — config is env-driven, so the env-rewrite + restart mechanism is correct; only the dashboard translation was missing.
- Pre-existing unrelated red on `supastack-rewrite`: `env-field-mapper-hooks.test.ts` asserts a stale honored count (188) vs the mapper's current count — not touched by this feature.
