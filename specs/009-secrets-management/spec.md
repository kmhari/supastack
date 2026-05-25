# Feature Specification: Secrets management — UI for edge function env + vault enablement

**Feature Branch**: `009-secrets-management`

**Created**: 2026-05-25

**Status**: Draft

**Input**: Bundles two related items into one user-visible feature:
1. **GitHub issue #5** (rescoped) — enable `pgsodium` + `supabase_vault` per-project so SQL contexts (`pg_cron`, triggers, `pg_net` webhooks, `SECURITY DEFINER` functions) can read secrets via `vault.decrypted_secrets`. Required for Cloud parity.
2. **Selfbase dashboard UI for edge function secrets** — Studio's `/project/default/functions/secrets` page is broken (shows documentation only, no CRUD). Selfbase has the backend (feature 003 US4: `GET/POST/DELETE /v1/projects/<ref>/secrets`) but no dashboard surface for it. Operators currently have to `curl` or use the `supabase` CLI. The dashboard needs a real edit page at `/dashboard/project/<ref>/secrets`, and Studio's broken URL needs to redirect there.

## Background

Selfbase has two distinct secret storage tracks today, both Cloud-compatible:

| Track | For | Storage | Propagation | Status |
|---|---|---|---|---|
| `.env` + container restart (feature 003 US4) | Edge function `Deno.env.get()` reads | `project_secrets` table (encrypted via master key) + per-instance `.env` file | 5-15s restart of `selfbase-<ref>-functions-1` | ✅ Backend shipped; UI gap |
| `supabase_vault` (THIS feature US3) | SQL-side `SELECT FROM vault.decrypted_secrets` (cron, triggers, pg_net, SECURITY DEFINER funcs) | `vault.secrets` in per-project Postgres (pgsodium-encrypted) | Instant (next SQL statement) | ❌ Extensions not enabled per-project; Studio's Vault UI dark |

This feature ships the UI for the first track AND turns on the extensions for the second.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Manage edge function secrets from the dashboard (Priority: P1)

An operator wants to set the `OPENAI_API_KEY` environment variable for their project's edge functions. They navigate to **Project → Settings → Secrets** (new sidebar entry under the existing project navigation). The page shows:

1. **Add or replace secrets** — a form with one or more rows of `Name` + `Value` fields, an "Add another" button to add more rows, and a "Save" button. Saving issues a batch upsert through the existing `POST /v1/projects/<ref>/secrets` endpoint.
2. **Custom secrets** — a searchable table of secrets they've already set, showing `Name`, `Digest (SHA256)` (the redacted indicator from the existing `valueSha256` field), `Updated` timestamp, and a per-row menu with `Delete` (and optionally `Replace value`).
3. **Default secrets** — a read-only reference table of the platform-reserved secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SB_REGION`, etc.) so operators understand what's auto-provided and what they shouldn't try to set themselves.

After clicking Save, the dashboard shows a toast: "Saving... functions container restarting" and the operator can refresh to confirm. Within ~15 seconds the new secrets are live; the operator's edge function can now read `Deno.env.get('OPENAI_API_KEY')` and get the saved value.

**Why this priority**: This is the operator's only sane path today besides curl. Without it the platform doesn't pass the basic "I'm a developer, I want to add an API key for my function" test. Backend is already shipped — pure UI work.

**Independent Test**: Visit `/dashboard/project/<ref>/secrets` as admin. Save a new secret `TEST_SECRET=hello`. Verify it appears in the Custom secrets table within seconds. Deploy a small edge function that returns `Deno.env.get('TEST_SECRET')` and invoke it — must return `"hello"` after the functions container restart completes.

**Acceptance Scenarios**:

1. **Given** the operator is on the Secrets page with no custom secrets, **When** they add one row (`NAME=FOO_API_KEY`, `VALUE=abc123`) and click Save, **Then** within 30 seconds the Custom secrets table shows `FOO_API_KEY` with its SHA-256 digest and a fresh `Updated` timestamp.
2. **Given** the operator adds multiple rows in one batch (5 secrets), **When** they click Save, **Then** all 5 are persisted in one server round-trip; the page does not require a save click per row.
3. **Given** the operator tries to save a reserved name like `SUPABASE_URL` or `JWT_SECRET`, **When** they click Save, **Then** the request is rejected with a clear error: "SUPABASE_URL is a reserved secret managed by selfbase. Reserved names cannot be set." The other (valid) entries in the same batch are also rejected (atomic batch, per the existing API contract).
4. **Given** the operator typed a value with leading/trailing whitespace or quotes, **When** they save, **Then** the value is stored verbatim (whitespace preserved) and the `.env` line is auto-quoted so the value reaches the edge runtime intact.
5. **Given** the Custom secrets table has 50 entries, **When** the operator types in the search box, **Then** the visible list filters to matching names client-side (no extra API call) within 50ms.
6. **Given** a value contains sensitive characters (newlines, embedded quotes), **When** the operator saves and re-loads the page, **Then** the digest matches what the platform stored; the original value never appears in the UI after save (UI shows digest only, not plaintext).
7. **Given** the operator deletes a secret via the per-row menu, **When** they confirm, **Then** the row vanishes from the table, the underlying `.env` line is removed, and the functions container restarts. Confirmation prompt names the specific secret being removed.
8. **Given** a non-admin team member views the page, **When** they load it, **Then** they either see a read-only view (Custom secrets table with digests but no Save/Delete buttons) OR are redirected away, matching the existing RBAC pattern.

---

### User Story 2 — Redirect Studio's broken Secrets URL to the selfbase page (Priority: P2)

When an operator clicks the "Secrets" link in Studio's Edge Functions sidebar at `https://studio-<ref>.<apex>/project/default/functions/secrets`, they currently land on a page that shows only documentation — no way to actually add, view, or delete secrets. The page is dead UX.

After this story ships, that URL responds with an HTTP 302 redirect to `https://<apex>/dashboard/project/<ref>/secrets` (the page built in US1). The operator clicks the link in Studio's sidebar, the browser follows the redirect transparently, and they land on the working selfbase secrets page.

**Why this priority**: Discoverability — operators following Studio's UI conventions naturally click the Secrets link. Without the redirect they think the platform is broken; with it, the broken page becomes a transparent handoff to the working one. Lower than US1 because US1 is the underlying capability — the redirect is just routing.

**Independent Test**: From a browser, navigate to `https://studio-<existing-ref>.<apex>/project/default/functions/secrets`. Verify the final URL after redirects is `https://<apex>/dashboard/project/<existing-ref>/secrets` and the secrets page loads.

**Acceptance Scenarios**:

1. **Given** an operator is in Studio's sidebar viewing edge functions, **When** they click "Secrets", **Then** the browser is redirected (HTTP 302) to `https://<apex>/dashboard/project/<ref>/secrets` and lands on the working selfbase page.
2. **Given** the redirect rule, **When** any URL matches `studio-<ref>.<apex>/project/default/functions/secrets[/...]`, **Then** the redirect target preserves the ref correctly: `<ref>` is extracted from the subdomain and substituted into the destination.
3. **Given** the redirect, **When** an authenticated Studio session redirects, **Then** the operator's selfbase session cookie carries over (both Studio and dashboard sit under the same apex's session-cookie scope) and they land on the page already authenticated, not at `/login`.
4. **Given** other Studio pages (e.g., `/project/default/functions/<slug>`), **When** the operator navigates, **Then** Studio renders normally — the redirect only matches the specific `/functions/secrets` path, not other function-related paths.

---

### User Story 3 — Enable `supabase_vault` per-project (closes issue #5) (Priority: P2)

An operator's SQL needs to call an external API from a `pg_cron` job or a trigger. The blessed pattern is `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'api_key'`. Today this fails with `relation "vault.decrypted_secrets" does not exist` because the `pgsodium` + `supabase_vault` extensions are bundled in our `supabase/postgres:15.8.1.085` image but not enabled per-project.

After this story ships, every new project gets both extensions enabled at provision time, AND a one-shot backfill script enables them on existing instances. Operators can then use Studio's existing Vault UI (under Settings → Vault in Studio) to add secrets, and their SQL can read them with the standard query.

**Why this priority**: Closes the rescoped issue #5. Not P1 because most projects don't use vault yet (huntvox's audit confirmed zero `vault.*` calls), but operators trying to follow standard Supabase patterns hit a dead end without it.

**Independent Test**: On an existing instance: run the backfill script. From psql as `supabase_admin`, run `SELECT extname FROM pg_extension WHERE extname IN ('pgsodium', 'supabase_vault')` — both must be present. Then `SELECT vault.create_secret('test-val', 'test_key')` followed by `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'test_key'` — must return `'test-val'`. Open Studio's Vault page — the secret added via SQL must appear in the UI.

**Acceptance Scenarios**:

1. **Given** a freshly provisioned project, **When** the operator runs `SELECT extname FROM pg_extension WHERE extname IN ('pgsodium', 'supabase_vault')`, **Then** both extensions are present and at their bundled versions.
2. **Given** an existing project provisioned before this feature shipped, **When** the operator runs the backfill action (button in the dashboard's Project Settings, or one-shot script), **Then** both extensions get enabled and the result is idempotent (re-running is a no-op).
3. **Given** the extensions are enabled, **When** a SQL caller runs `SELECT vault.create_secret('value', 'name')` then `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'name'`, **Then** the second query returns `'value'`.
4. **Given** the extensions are enabled, **When** the operator visits Studio's Vault page, **Then** the page renders and any secrets created via SQL appear; secrets created via the Studio UI are readable from SQL.
5. **Given** the backfill is run against an instance that already has the extensions, **When** it executes, **Then** it succeeds quickly with no error and no version downgrade.
6. **Given** the extensions are enabled, **When** the operator deletes their project via the existing lifecycle delete, **Then** the per-project Postgres is dropped normally (vault is a per-project extension; nothing in selfbase's control plane references it).

---

### Edge Cases

**Secrets UI (US1):**
- **Empty value submitted**: rejected at the form layer with "Value cannot be empty — use Delete to remove a secret instead."
- **Duplicate name in a single batch**: client warns + collapses into one entry (the last value wins), preventing the API from rejecting the batch as ambiguous.
- **Paste of `KEY=value` lines into the Name field**: the form auto-splits at the first `=` and fills both Name and Value — UX nicety matching Supabase Cloud's behavior.
- **`.env` file corrupted on disk** (race during write): the backend already does atomic rename + rollback per the existing secret-store code; UI just shows the resulting error message from the API.
- **Container restart fails after Save** (existing `restart_failed` error code from feature 003): UI shows red banner with the underlying error and a "Retry" button.
- **Operator opens the page during an active container restart**: page renders normally; if a Save fires while another is in flight, second request gets queued server-side per the existing API contract.
- **Very large value** (>64KB, e.g., a multiline PEM): allowed by the backend; UI's Value field accepts multi-line input via a "Paste large value" toggle that switches to a `<textarea>`.

**Studio redirect (US2):**
- **Self-referential redirect loop**: the destination is on a different subdomain (`<apex>` vs `studio-<ref>.<apex>`) so loops are impossible.
- **Ref doesn't match the studio host's project**: the ref is extracted from the host header, so the redirect always lands on the correct project's selfbase page; mismatch is impossible by construction.
- **Operator on selfbase but not logged in**: the redirect lands them at `/login` then bounces back to the secrets page after auth (existing dashboard pattern).
- **Future Studio version moves the URL**: the redirect rule is path-specific (`/project/default/functions/secrets`). If Studio relocates the page, the operator sees the broken Studio page again until we update the rule. Acceptable — Studio upstream is rarely-changing.

**Vault enablement (US3):**
- **Per-project Postgres is paused at backfill time**: backfill skips paused projects with a clear log entry; operator resumes the project and re-runs the backfill to pick it up.
- **`pgsodium` server key was not initialized on the project's PG** (older instances): backfill calls `SELECT pgsodium.create_root_key()` if missing before enabling vault. Idempotent.
- **Operator restores a per-project PG backup taken before this feature shipped**: the backfill is safe to re-run after restore; vault extension installation is idempotent.
- **A future Postgres-image upgrade ships different pgsodium/vault versions**: extension upgrade happens automatically on the next `CREATE EXTENSION IF NOT EXISTS` call; existing vault data is preserved across upgrades per the upstream contract.

## Requirements *(mandatory)*

### Functional Requirements

#### Secrets UI (US1)

- **FR-001**: System MUST expose a new dashboard route at `/dashboard/project/<ref>/secrets` rendered inside the existing project shell, with the existing project sidebar showing a "Secrets" entry that highlights when active.
- **FR-002**: The page MUST render three sections: (a) "Add or replace secrets" form with row-style Name/Value inputs + "Add another" + "Save" + "Paste large value" toggle for multi-line, (b) "Custom secrets" searchable table with columns Name, Digest (SHA-256), Updated, and a per-row menu (Replace / Delete), (c) "Default secrets" read-only reference table listing platform-reserved names with one-line descriptions.
- **FR-003**: The Save action MUST send all rows as a single batch to `POST /v1/projects/<ref>/secrets`. On success, the page MUST refetch the Custom secrets list and clear the form. On batch validation failure (reserved name, invalid format), the response MUST surface the offending name + reason inline.
- **FR-004**: The Custom secrets table MUST never display plaintext values — only the SHA-256 digest from the existing `valueSha256` field — matching the upstream Cloud UX shown in the reference screenshot.
- **FR-005**: The Delete action MUST require a confirmation dialog naming the specific secret(s) being removed. On confirm, send a single batch `DELETE /v1/projects/<ref>/secrets` with the name(s).
- **FR-006**: The search box MUST filter the Custom secrets table client-side (no API call) on substring match against the secret name; case-insensitive.
- **FR-007**: Access to the page MUST be RBAC-gated via a new action `instance.secrets.write` for editing (admin-only) and the existing `instance.read` for viewing. Non-write users see the page but the Save/Delete buttons are hidden or disabled.
- **FR-008**: The "Default secrets" reference table content MUST be derived from the existing `RESERVED_SECRET_NAMES` list in `apps/api/src/services/secret-store.ts` plus a short hand-written description per name. (Maintain the list in `packages/shared` so api + web stay in sync.)

#### Studio redirect (US2)

- **FR-009**: The platform MUST issue an HTTP 302 redirect for any request whose host matches `studio-<ref>.<apex>` and path matches `/project/default/functions/secrets[/...]`, where `<ref>` is the 20-character ref pattern. The redirect MUST target `https://<apex>/dashboard/project/<ref>/secrets` with the same protocol (HTTPS).
- **FR-010**: The redirect MUST preserve query strings (`?preset=foo` → `?preset=foo`) and trailing path segments under the matched prefix.
- **FR-011**: The redirect MUST be implemented at the reverse-proxy layer (Caddy) so it fires before any request reaches Studio's container — Studio never sees the request, no Studio modification required.
- **FR-012**: Only the exact `/project/default/functions/secrets[/...]` prefix MUST be redirected. All other Studio paths (e.g., `/project/default/sql`, `/project/default/functions/<slug>`, `/project/default/database`) MUST pass through to Studio unchanged.

#### Vault enablement (US3, closes #5)

- **FR-013**: The per-instance provision flow MUST enable `pgsodium` + `supabase_vault` extensions at the end of the per-project bootstrap SQL (after the db service is healthy + per-instance migrations run). Specifically: `CREATE EXTENSION IF NOT EXISTS pgsodium; CREATE EXTENSION IF NOT EXISTS supabase_vault;`.
- **FR-014**: A one-shot backfill script MUST exist (and be runnable via the dashboard for admins, or via `docker exec` for ops) that connects to each existing instance's Postgres and enables both extensions. Idempotent: re-running is a no-op.
- **FR-015**: After both extensions are enabled, the standard SQL test `SELECT vault.create_secret('test', 'test_key'); SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'test_key';` MUST succeed and return `'test'`.
- **FR-016**: Studio's existing Vault UI (built into the upstream Studio image) MUST render correctly for any per-project Studio once the extensions are enabled — no selfbase-side changes to Studio required.
- **FR-017**: A new project's status MUST NOT become `running` until both extensions are confirmed enabled — extension enablement becomes part of the provision-time success criterion (alongside the existing pg_password_drift probe from feature 008).

#### Cross-cutting

- **FR-018**: All new dashboard endpoints (if any beyond what already exists for the secrets backend) MUST use the existing `/api/v1/*` mount + session cookie auth, not the `/v1/*` Supabase Management API surface.
- **FR-019**: All write operations MUST emit existing-style audit log entries — `instance.secrets.set`, `instance.secrets.delete` for the secrets UI; `instance.vault.enabled` for the backfill. Severity: normal.
- **FR-020**: The Studio redirect MUST work for every project on the deployment without per-project config — the rule applies to all `studio-*.<apex>` hosts uniformly.

### Key Entities

- **Project secret** (already exists from feature 003 US4): row in `project_secrets` table — id, instance_ref FK, name, encrypted_value bytea, value_sha256, created_at/updated_at, created_by/updated_by. No schema change.
- **Reserved secret name** (existing, now exposed via shared package): the `RESERVED_SECRET_NAMES` list — currently lives only in `apps/api/src/services/secret-store.ts`; this feature moves it to `packages/shared` and adds a human-readable description per name.
- **Vault secret** (new — managed by Postgres, not selfbase): row in per-project Postgres `vault.secrets` table (pgsodium-encrypted). Selfbase never reads/writes this; the per-project PG handles all of it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can add, view, search, edit, and delete edge function secrets via the dashboard without leaving the browser, with no curl or CLI required. (US1)
- **SC-002**: Saving 10 secrets in one batch completes in under 30 seconds end-to-end (form submit → table refresh showing new digests + restarted functions container ready to read the new env). (US1)
- **SC-003**: For 100% of projects, clicking Studio's "Secrets" link in the Edge Functions sidebar lands the operator on the working selfbase secrets page within 1 second. (US2)
- **SC-004**: For 100% of existing projects, running the backfill script enables `pgsodium` + `supabase_vault` and the standard `vault.create_secret` / `decrypted_secrets` test passes immediately after. (US3)
- **SC-005**: For 100% of new projects provisioned after this feature ships, both extensions are enabled by provision-time and the standard vault test passes without any extra action. (US3)
- **SC-006**: Studio's existing Vault UI (Settings → Vault inside Studio) renders without error for any project on the deployment after backfill. (US3)
- **SC-007**: Zero regressions for existing edge-function workflows — secrets set via CLI (`supabase secrets set`) continue to work and continue to appear in the new dashboard UI (and vice versa). (US1 + cross-cutting)
- **SC-008**: Non-admin users either see a read-only view of the Secrets page (no edit buttons) or are redirected away — never see a 500 or a half-working form. (US1, RBAC)

## Assumptions

- The `POST /v1/projects/<ref>/secrets` + `GET` + `DELETE` endpoints from feature 003 US4 are stable and complete; this feature wraps them with UI, doesn't change them. The existing `valueSha256` field becomes the dashboard's "Digest" column.
- The `RESERVED_SECRET_NAMES` list in `apps/api/src/services/secret-store.ts` is the canonical truth for what counts as "default" — moving it to `packages/shared` makes it available to the React dashboard without duplicating.
- Caddy is the right place for the Studio URL redirect because it sits in front of Studio anyway (the `studio-<ref>.<apex>` hostname is routed by Caddy → per-instance Studio container). A redirect rule on the specific path stops the request before Studio sees it; no Studio modification needed. Operators cannot bypass it.
- The `pgsodium` + `supabase_vault` extensions in supabase/postgres:15.8.1.085 work without further configuration as long as both are installed in dependency order (pgsodium first). The image already includes the libsodium library — no shared-library install needed.
- The per-project Postgres `supabase_admin` role (used by the provision worker + reset-pg-password from feature 008) has SUPERUSER and CAN install extensions. No new role needed.
- Backfilling extension enablement on existing instances does not require a container restart — `CREATE EXTENSION` is online. Existing client connections are unaffected.
- Studio's Edge Function "Secrets" page being a docs-only stub is a known upstream limitation, not a config issue we can resolve in Studio. The redirect is the simplest fix.
- The existing dashboard's project sidebar (`apps/web/src/components/ProjectShell.tsx` or equivalent) accepts an additional nav entry without restructuring. The dashboard's Settings sidebar pattern (from the 008 work) is the design reference.
- Out of scope: a UI for the vault track (selfbase doesn't expose a dashboard for `vault.secrets`; operators use Studio's built-in Vault page for that). Selfbase only owns the `.env`-backed secret UI.
- Out of scope: changing what reserved names mean or adding new reserved names. The current list (~25 entries) is the v1 ground truth.
- Out of scope: showing per-instance container restart status during/after a Save — the current API returns when the restart completes and surfaces failures via `restart_failed`; the dashboard relies on that contract without polling for restart progress.
- Out of scope: importing / exporting secrets in bulk (e.g., upload a `.env` file). Operators do single-row or paste-multiline today.
- Out of scope: rotating selfbase's master key or re-encrypting `encrypted_value` blobs — separate operational concern.
