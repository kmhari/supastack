# Contract: Platform auth-config endpoints (Studio-facing)

All four endpoints are mounted under the platform prefix → live URL `https://<apex>/api/v1/platform/...`. Auth: GoTrue access JWT or admin PAT for an operator authorized on the project's org. Field names are **UPPERCASE** (Studio / GoTrueConfig convention).

---

## `GET /platform/auth/:ref/config`

Returns the project's current auth configuration in the **uppercase** convention Studio reads.

- **200** — flat object of config fields, keys UPPERCASE (e.g. `EXTERNAL_GITHUB_ENABLED`, `SITE_URL`, `JWT_EXP`, `SMTP_HOST`, …). The `_supastack` meta object (if present) is passed through verbatim (not upper-cased). Secret-bearing fields masked exactly as the underlying `/v1` response masks them.
- **404** — caller not authorized on the project, or project not found (no info leak beyond current behavior).

**Acceptance**:
- A field enabled via PATCH is present + truthy in this response under its UPPERCASE key (round-trip, FR-003/SC-003).
- `_supastack.fieldStatus` (if returned by the underlying `/v1`) is unchanged in shape.

---

## `PATCH /platform/auth/:ref/config`

Accepts a partial **uppercase** auth-config update, applies it to the project's GoTrue.

- **Request body**: partial object, UPPERCASE keys. Example:
  ```json
  { "EXTERNAL_GITHUB_ENABLED": true,
    "EXTERNAL_GITHUB_CLIENT_ID": "<id>",
    "EXTERNAL_GITHUB_SECRET": "<secret>" }
  ```
- **200** — accepted; the underlying `/v1` patch succeeded; GoTrue reload triggered (dashboard "applying → done").
- **400** — validation failed; body `{ error: { code: "validation_failed", details: { "<UPPERCASE_FIELD>": "unknown_field" | "<message>" } } }`. `details` keys are in the **Studio (uppercase)** key space (FR-007). **Not** a 500.
- **404** — not authorized / not found.
- **409** — project not running (`project_not_running`) (FR-011).

**Acceptance**:
- The exact failing payload from the live report (`EXTERNAL_GITHUB_ENABLED` + creds) now returns **200**, not 500 (SC-001).
- A subset payload changes only those fields (partial-update preserved, FR-006).
- A genuinely unknown field → 400 with that field named (uppercase) (SC-006).

---

## `GET /platform/auth/:ref/config/hooks`

Returns the project's current auth-hook configuration (the `hook_*` subset), UPPERCASE.

- **200** — `{ "HOOK_CUSTOM_ACCESS_TOKEN_ENABLED": false, "HOOK_MFA_VERIFICATION_ATTEMPT_ENABLED": false, … }` (all 7 hooks; enabled flags + URIs; secrets masked). Loads cleanly for a project with no hooks (all disabled).
- **404** — not authorized / not found.

---

## `PATCH /platform/auth/:ref/config/hooks`

Persists auth-hook changes, applies via the existing reload.

- **Request body**: partial uppercase hook fields (enabled + URI + secrets).
- **200** — accepted; reflected on subsequent GET.
- **400** — invalid hook config (e.g. enabled without a valid `pg-functions://` URI — reuse feature 082 cross-field validation), field named (uppercase).
- **404 / 409** — as above.

**Acceptance**: enable a hook with a valid target → 200 → present on reload (US4/SC-007).
