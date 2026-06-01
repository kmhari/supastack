# Research: Secret Reveal — No-Password UI Masking

**Branch**: `081-secret-reveal-no-password` | **Date**: 2026-05-25

---

## Decision 1: How to remove the password gate from the credentials reveal endpoint

**Decision**: Strip the password parsing and `verifyPassword` call from the existing `POST /api/v1/instances/:ref/credentials/reveal` endpoint. Keep the endpoint as POST (no method change). The body is ignored (Fastify accepts an empty or absent body without error). The `app.authorize(req, 'instance.reveal-credentials')` RBAC gate and `auditLog` insert are retained unchanged.

**Rationale**: Minimal diff. POST semantics are acceptable here because the audit log insert is a side effect that makes GET inappropriate by strict REST convention. The response shape is unchanged, so no frontend consumers break. The `CredentialRevealRequest` schema in `packages/shared` is left in place (no active callers after this change); cleanup is a separate task.

**Alternatives considered**:
- Change to GET: Cleaner semantics for a read-only resource, but the audit log insert is a write side effect. Changing method would also require updating the Fastify route type parameter. Rejected to minimize diff.
- Make password optional (Zod `.optional()`): Would preserve the schema but is confusing — optional password signals the feature could go either way. Rejected for clarity.

---

## Decision 2: How to expose OAuth client secrets for reveal

**Decision**: Add a new `GET /api/v1/projects/:ref/config/auth/reveal` route in `apps/api/src/routes/management/auth-config.ts`. This route calls a new exported `getPlaintextConfig(ref, 'auth')` function in `runtime-config-store.ts` that wraps the existing `loadCurrentPlaintext()` (already private) without calling `redactSecrets()`. The route requires `app.requireAuth` + `app.authorize(req, 'auth_config.read')` and inserts an audit log entry (`action: 'secret.reveal'`).

**Rationale**: The existing `GET /projects/:ref/config/auth` (via `getConfig`) always redacts secrets. A separate reveal endpoint avoids breaking the standard GET contract and makes the reveal intent explicit. Reusing `auth_config.read` permission keeps the RBAC matrix unchanged (no new action needed). The endpoint is registered under `/api/v1` prefix (same as the dashboard GET), so the frontend can call it via `client.get('/projects/:ref/config/auth/reveal')` using the existing axios instance.

**Alternatives considered**:
- Extend the existing credentials/reveal endpoint to also return auth config secrets: Would bundle two unrelated secret stores into one response. The credentials reveal endpoint decrypts `encryptedSecrets` (from `instances` table); the auth config reveal decrypts `project_config_snapshots`. Keeping them separate is cleaner.
- Add a field-level reveal endpoint (`GET /config/auth/reveal?field=external_github_secret`): More granular but more complex. The frontend fetches the whole config and extracts the field it needs — no need for field-level granularity.

---

## Decision 3: Frontend — which component owns the reveal API call for OAuth forms

**Decision**: Each OAuth form component owns its own reveal state (`revealed`, `revealing`) and calls `instancesApi.revealAuthConfig(projectRef)` directly when the user clicks Reveal. The returned config is keyed by the form's `fm.secret!` field map entry to extract the specific provider's secret.

**Rationale**: OAuth forms are independent drawers rendered one at a time; there is no shared "credentials" context across them (unlike JWT/API keys which share `useRevealCredentials`). Adding a shared hook would introduce coupling with no benefit. The API call is infrequent (on-demand) so per-form state is fine.

**Alternatives considered**:
- Extend `useRevealCredentials` to also cover auth config: The hook returns `creds` (instance secrets). Adding OAuth config would make it a mixed-concern hook. Rejected.
- Cache the auth config reveal response across all open drawers: Overkill — users open one drawer at a time.

---

## Decision 4: Reveal UX — one-way vs toggleable

**Decision**: Reveal is one-way per page/drawer session. For JWT/API keys: once the value is shown, it stays visible; the Reveal button is replaced by the built-in Copy button (via `noCopy={false}`, `rightSlot={undefined}`). For OAuth drawers: the Reveal button disappears; the input type switches to `text` and the value populates the input field.

**Rationale**: One-way reveal reduces UI complexity. Re-masking the value after reveal provides no real security benefit (the value has already been seen; clipboard may hold it). The eye-toggle was removed from both pages as part of this simplification.

**Alternatives considered**:
- Eye/EyeOff toggle after reveal: Adds complexity for minimal gain. The current code already has this for service_role key; removing it is the simplification the user requested.

---

## Decision 5: RBAC — existing permissions sufficient

**Decision**: No new RBAC actions required.
- JWT/API key reveal: reuses `instance.reveal-credentials` (already admin-only in `packages/shared/src/rbac.ts`)
- OAuth config reveal: reuses `auth_config.read` (already admin-only)

**Rationale**: Both existing actions are already admin-gated. Adding new actions would require schema changes in `rbac.ts` with no new security boundary.
