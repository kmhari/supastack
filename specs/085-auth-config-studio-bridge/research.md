# Phase 0 Research: Auth Config Studio parity

All decisions below are grounded in the live investigation on `supaviser.dev` (project `tbnqljlgozpxzhkjxats`) and the existing code (`env-field-mapper.ts`, `runtime-config-store.ts`, `platform-misc.ts`, `management/auth-config.ts`).

## R1 — Translation strategy: case-flip on mapper keys (not envName)

**Decision**: Translate Studio ↔ Management API by **lower-casing / upper-casing the field key**, validated against the `env-field-mapper.ts` key set, plus a small explicit **alias table** for any field whose Studio name diverges beyond case.

**Rationale**: Empirically, Studio's field names are exactly the UPPERCASE of the Management API (mapper key) names:
- `EXTERNAL_GITHUB_ENABLED`.toLowerCase() === `external_github_enabled` (mapper key) ✓
- `SITE_URL` → `site_url` ✓ · `JWT_EXP` → `jwt_exp` ✓ · `URI_ALLOW_LIST` → `uri_allow_list` ✓ · `MAILER_AUTOCONFIRM` → `mailer_autoconfirm` ✓

The mapper's **`envName` is NOT a usable bridge** — it is inconsistent and lossy: `jwt_exp`→`JWT_EXPIRY`, `uri_allow_list`→`ADDITIONAL_REDIRECT_URLS`, `mailer_autoconfirm`→`ENABLE_EMAIL_AUTOCONFIRM`, while `external_github_enabled`→`GOTRUE_EXTERNAL_GITHUB_ENABLED`. So envName must be ignored for the Studio mapping; the **mapper key** (the upstream Management API field name) is the canonical token, and Studio sends its upper-case.

**Alternatives considered**:
- *envName-based bridge* — rejected: envName is internally inconsistent (above) and is the GoTrue runtime var, not the API field name Studio uses.
- *blind `toLowerCase()` with no validation* — rejected: silently lower-cases unknown keys, defeating the "unknown field: X" requirement (FR-007) and risking collisions; we validate against the known key set and pass unknown keys through so the strict schema reports them.
- *a second, uppercase platform schema* — rejected: duplicates 234 fields, two schemas to keep in sync, violates DRY and risks `/v1` drift.

**Open verification (Phase 1 task)**: enumerate the full Studio auth-config payload field set and assert `studioKey.toLowerCase() ∈ mapperKeys` for every key; any exception goes in the alias table. Build the assertion from the mapper's exported key list so it self-maintains.

## R2 — Where to translate: the platform bridge only

**Decision**: Apply translation exclusively in `platform-misc.ts` GET/PATCH `/platform/auth/:ref/config` (and the new `/config/hooks`). The Management API `/v1/projects/:ref/config/auth` handler, schema, and snapshot are untouched.

**Rationale**: Constitution IV — the `/v1` surface is a pinned upstream contract (lowercase, `.strict()`) consumed by the Supabase CLI/automation, which already works. Confining translation to the platform edge means the CLI path is provably unaffected and the existing `/v1` regression/snapshot tests still pass unchanged.

**Mechanism**: `PATCH` → `toApiKeys(body)` (uppercase→lowercase) before the in-process re-inject to `/api/v1/projects/:ref/config/auth`. `GET` → `toStudioKeys(resp.body)` (lowercase→uppercase) on the response before returning.

## R3 — GET response: the `_supastack` meta key

**Decision**: When upper-casing the GET response keys, **upper-case only the real config fields and preserve the `_supastack` extension object verbatim** (do not upper-case `_supastack` → `_SUPASTACK`, and recurse into `_supastack.fieldStatus` only if Studio reads it — default: leave it untouched; Studio ignores unknown keys).

**Rationale**: `runtime-config-store.ts` attaches `_supastack.fieldStatus` (feature 020) for the supastack dashboard's field-status UI. Studio doesn't read it; mangling it would break feature 020's existing contract test. Safest: a denylist of meta keys (`_supastack`) excluded from case translation. Verified: the response is a flat object of config fields plus the single `_supastack` object.

## R4 — `/config/hooks` wiring

**Decision**: Implement `GET/PATCH /platform/auth/:ref/config/hooks` in the platform bridge. **GET** returns the hook-subset of the project's current auth config (the `hook_*` honored fields, feature 082), upper-cased for Studio. **PATCH** translates + writes the hook fields through the same `patchConfig('auth', …)` path (hooks are part of the auth config field set, not a separate store), then applies via the existing reload.

**Rationale**: There is **no** `/config/hooks` handler today (grep-confirmed) — the doc's ⚠️ mock rows. Feature 082 already promoted the 21 `hook_*` fields to honored in `env-field-mapper.ts` and they flow through `/config/auth`; so `/config/hooks` is a **scoped view/write** over that same subset, not a new subsystem. This keeps one source of truth (the auth config) and avoids a parallel hook store.

**Open verification (Phase 1)**: confirm whether Studio's hooks page actually calls `/config/hooks` or routes hook fields through `/config/auth`. If it uses `/config/auth` for writes, `/config/hooks` may only need a GET; we implement both to be safe and harmless. (Captured as an assumption in the spec; resolved by inspecting the deployed Studio's network calls.)

## R5 — Error masking: surface 400 + details, not 500 "internal error"

**Decision**: Make the platform bridge propagate the underlying `ManagementApiError` (status + `details`) instead of the generic 500. Two viable mechanisms — pick during implementation:
- **(a)** Re-inject to the `/v1/projects/:ref/config/auth` path (which is wrapped by the `mgmt-api-errors.ts` envelope → 400 + `details`) instead of the `/api/v1/...` path; the bridge already forwards `resp.statusCode` + `resp.json()`, so a real 400 would pass through. **Preferred** — smallest change, reuses the correct envelope.
- **(b)** Teach the platform error handler (`server.ts:190`) to recognize `ManagementApiError` and emit its `statusCode` + `details`.

**Rationale**: Root cause confirmed from logs — `management/auth-config.ts` throws `ManagementApiError(400, 'Validation failed', …, details)`, but the bridge injects to the **`/api/v1/...` (platform-mounted)** route whose error handler is the generic `server.ts:190` → `{code:'internal'}` 500. The `/v1`-mounted copy carries the proper envelope. Routing the bridge through the `/v1` surface is the least-surprise fix and also means the *displayed* error already matches upstream's shape.

**Constraint**: whichever mechanism, the `details` (`{"EXTERNAL_GITHUB_X":"unknown_field"}`) should be translated back to the Studio (uppercase) key space so the dashboard highlights the right field. With R1 correct, well-formed payloads won't hit this; it's the safety net for genuinely invalid input.

## R6 — No new dependency / no migration

**Decision**: Pure in-process TypeScript; reuse `app.inject`, Zod, and the existing mapper. No package added, no DB migration, no worker job (apply path unchanged).

**Rationale**: The feature is a key-name remap + two thin endpoints + an error-propagation fix. Constitution I (migrations) is trivially satisfied (none); V (worker) unchanged.

## Resolved unknowns

| Unknown (from Technical Context) | Resolution |
|---|---|
| Is Studio↔api a clean case-flip or needs explicit mapping? | Clean case-flip on **mapper keys**; alias table only for divergences (R1). |
| Translate at the bridge or change the schema? | Bridge only; `/v1` schema pinned (R2, Constitution IV). |
| How to handle `_supastack.fieldStatus` on GET? | Exclude meta keys from case translation (R3). |
| Do `/config/hooks` endpoints exist? | No — must be created; backed by the `hook_*` auth-config subset (R4). |
| Why "internal error" (500) not 400? | Bridge injects to the platform-mounted route (generic 500 handler), not the `/v1` route (proper 400 envelope) (R5). |
| New deps / migration? | None (R6). |
