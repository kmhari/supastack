# Implementation Plan: Auth Providers Dashboard + Behavioral Parity (Feature 020)

**Branch**: `020-auth-providers-dashboard` | **Date**: 2026-05-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/020-auth-providers-dashboard/spec.md`

## Summary

Combined backend + dashboard feature closing issues #21 and #34. Five user stories grouped into three implementation tracks that can be developed in parallel and stitched at the end:

- **Track A — Backend field-mapping & transparency** (US3 + US4): Expand `apps/api/src/services/env-field-mapper.ts` from 24 honored fields to a target of **165 honored** (target 165, ± 5 tolerance per research R-001; minimum acceptable 160). The promotion set is 17 new OAuth providers + Slack OIDC variant + per-family extras (~77 OAuth fields), ~37 mailer, 20 sessions/password/webauthn-rp/passkey/api/db/smtp-misc, 7 rate limits. Uncomment matching `GOTRUE_*` env lines in `infra/supabase-template/docker-compose.yml`; build the per-field status map; surface it on `GET /v1/projects/<ref>/config/auth` under a `_selfbase` namespaced key. Add a snapshot-drift contract test that fails the build when an upstream OpenAPI refresh introduces an unclassified field.
- **Track B — Behavioral parity test harness** (US3): Build `tests/cli-e2e/auth-config-behavioral-parity.sh` plus a CI coverage check that every `honored` field has at least one assertion.
- **Track C — Dashboard Auth Providers page** (US1 + US2 + US5): Add a top-level Authentication sidebar group with a Providers page mirroring Cloud's `/auth/providers`. Side-drawer per provider; pre-filled read-only Callback URL with Copy; container-restart toast with healthcheck poll; disabled "Coming soon" rows for SAML / Web3 / Custom Providers.

No new RBAC actions (`auth_config.read` + `auth_config.write` already exist). No new MGMT API endpoints (reuses `GET/PATCH /v1/projects/:ref/config/auth`). No new BullMQ jobs (reuses existing container-restart from feature 009). No new DB tables (snapshot row from feature 009 already stores the JSON).

The combined feature is the implementation of feature 019's spec (which only covered #21) plus #34; feature 019 is superseded.

## Technical Context

**Language/Version**: TypeScript 5.x, Node 20 LTS (api, worker, web); shadcn/ui (web); Bash + curl + jq (e2e harness)

**Primary Dependencies**:
- `fastify` — existing api framework; reuse `authConfigRoutes` route module
- `zod` — `UpdateAuthConfigBodySchema` is generated from upstream OpenAPI snapshot in `packages/shared/src/schemas/`
- `@radix-ui/react-dialog` (via shadcn) — basis for the side drawer; new `Sheet` component to be added (not yet present in `apps/web/src/components/ui/`)
- `react-router-dom` — existing routing; one new route `/dashboard/project/:ref/auth/providers`
- `sonner` — existing toast primitive; one new toast variant for the restart UX (already added to `apps/web/src/components/ui/sonner.tsx`)
- `vitest` — existing test runner; new contract + coverage tests under `apps/api/tests/`

**Storage**: No new tables. Reads/writes `project_config_snapshots` rows via feature 009's `runtime-config-store` service. Provider secrets remain in that encrypted snapshot (vault migration deferred to #70).

**Testing**:
- `apps/api/tests/unit/` — vitest unit tests for the field-status map + classification logic + GET response shape
- `apps/api/tests/contract/` — new snapshot-drift contract test (NEW directory)
- `tests/cli-e2e/auth-config-behavioral-parity.sh` — new live-VM e2e script
- `apps/web/src/` — vitest + react-testing-library for the page + drawer state machine (a small first cut; the bulk of UX validation is manual + e2e via the same Bash harness driving the api)

**Target Platform**: Selfbase control-plane stack (api / worker / web), per-instance auth container is `selfbase-<ref>-auth` (gotrue). All changes ship via the standard rsync → `docker compose build` → `docker compose up -d` cycle on the production VM (`ubuntu@148.113.1.164`, apex `supaviser.dev`).

**Project Type**: Web application (full-stack — api + web both modified).

**Performance Goals**:
- Provider drawer Save → toast appears in < 200ms (single PATCH, no synchronous wait for restart).
- Container restart healthcheck poll converges in ≤ 60s on a healthy VM (SC-007).
- Backend GET with the new transparency layer adds < 10ms to existing response time (single in-memory map lookup per field).
- 20 OAuth providers (21 rendered rows including Slack legacy + OIDC) + behavioral parity test running ~165 assertions completes in < 10 min on the e2e VM (each PATCH triggers ~30s restart; loop is bounded by serialized container restarts).

**Constraints**:
- Reuse the existing distributed per-project lock for concurrent PATCH protection (already implemented in feature 009 `runtime-config-store`).
- Honored-field count of 165 (± 5) is a testable target; CI fails if it falls below 160 or rises above 170 without an explicit status-map update.
- `supabase` CLI must keep working unchanged — the `_selfbase` extension key on GET must be additive-only.
- No bump of the pinned GoTrue image (MFA / webauthn flags requiring a newer image stay deferred to #65).
- Provider secrets stay encrypted in `project_config_snapshots`; no migration into `vault.secrets` (#70 tracks that).

**Scale/Scope**:
- 1 new web page (`ProjectAuthProviders.tsx`) + 5 provider-form-template components + 1 new Sheet primitive
- 1 expanded mapping module (`env-field-mapper.ts`) growing from ~130 lines to ~400
- 1 new contract test, 1 new coverage test, 1 new e2e script
- ~140 new lines in `infra/supabase-template/docker-compose.yml` (uncommenting + adding env mappings for promoted fields)
- Operator runbook update: `docs/changes/020-auth-providers.md`

## Constitution Check

No project constitution defined (template only). Project conventions from CLAUDE.md:

- **Idempotent migrations**: N/A — no migrations in this feature.
- **One BullMQ job per concern**: N/A — no new jobs (reuses feature 009 restart).
- **Per-instance state changes go through the worker**: PATCH triggers container restart from the api thread via `restartOrRollback` (same as feature 009). No change.
- **Dashboard endpoints under `/api/v1/*`** vs **Management API under `/v1/*`**: Dashboard reuses the existing `/v1/projects/:ref/config/auth` Management endpoint directly (no `/api/v1/*` wrapper) because the API surface is identical to what the CLI already uses; adding a parallel internal route would just duplicate validation and audit. Justified in Complexity Tracking below.
- **Tests prefer pure functions where possible**: Field-mapping logic is pure. Behavioral parity is necessarily live-VM (matches existing `tests/cli-e2e/*` posture).
- **`any` in tests is allowed**: We'll use it where typed mocks add no value.

All gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/020-auth-providers-dashboard/
├── plan.md              ← this file
├── spec.md
├── research.md          ← Phase 0 — decisions for all 5 USs
├── data-model.md        ← Phase 1 — field-status map shape + drawer state machine
├── quickstart.md        ← Phase 1 — smoke tests + manual ops guide
├── contracts/
│   ├── auth-config-get-response.md       ← GET shape including _selfbase extension
│   └── provider-form-templates.md        ← Per-provider form field sets
└── tasks.md             ← Phase 2 (generated by /speckit-tasks — NOT in this command)
```

### Source Code (files created or modified)

```text
# ─── Track A: Backend field-mapping & transparency ───────────────────────

apps/api/src/services/
  env-field-mapper.ts                    MODIFIED — expand to 165 honored fields, add status map + reason text
  runtime-config-store.ts                MODIFIED — getConfig() composes the _selfbase extension into the GET response

apps/api/src/routes/management/
  auth-config.ts                         UNCHANGED — route module unaffected; response shape change is upstream of it

apps/api/tests/unit/
  env-field-mapper.test.ts               NEW — coverage check: every honored field has a behavioral assertion (cross-refs e2e)
  auth-config-response-shape.test.ts     NEW — GET includes _selfbase.fieldStatus; CLI-ignorance simulated

apps/api/tests/contract/
  upstream-auth-config-snapshot.test.ts  NEW — diff snapshot keys vs status-map keys; fails on unclassified field

# ─── Track A: Infra (env wiring) ────────────────────────────────────────

infra/supabase-template/
  docker-compose.yml                     MODIFIED — uncomment + wire env vars for 17 newly-promoted OAuth providers + Slack OIDC variant, mailer subjects/notifications/templates, rate limits, sessions, password rules, webauthn-rp, passkey

# ─── Track B: Behavioral parity test harness ────────────────────────────

tests/cli-e2e/
  auth-config-behavioral-parity.sh       NEW — drives 165 PATCH+assert cycles against a live test project
  helpers/auth-config-assertions.sh      NEW — per-assertion library (token-TTL probe, OAuth handshake probe, mailer-subject probe, rate-limit probe, etc.)

# ─── Track C: Dashboard Auth Providers page ─────────────────────────────

apps/web/src/components/ui/
  sheet.tsx                              NEW — shadcn Sheet (side drawer) primitive

apps/web/src/components/
  ProjectShell.tsx                       MODIFIED — add Authentication sidebar group with "Providers" entry

apps/web/src/pages/
  ProjectAuthProviders.tsx               NEW — list page + drawer state machine + restart-toast orchestration

apps/web/src/pages/auth-providers/
  provider-registry.ts                   NEW — 25 provider definitions (icon, name, form template, field map, callback URL, "coming soon" target issue)
  CommonFour.tsx                         NEW — form template A: enable + client_id + secret + email_optional
  PlusUrl.tsx                            NEW — form template B: CommonFour + url
  WorkOsShape.tsx                        NEW — form template C: enable + client_id + secret + url
  GoogleForm.tsx                         NEW — form template D-google: CommonFour + additional_client_ids + skip_nonce_check
  AppleForm.tsx                          NEW — form template D-apple: CommonFour + additional_client_ids
  OidcForm.tsx                           NEW — form template E: oidc_-prefixed CommonFour
  GlobalTogglesForm.tsx                  NEW — top-of-page 4-toggle bundle (sign-up / manual linking / anonymous / confirm email)
  ComingSoonRow.tsx                      NEW — disabled placeholder row for SAML / Web3 / Custom Providers
  callback-url.ts                        NEW — `https://<ref>.<apex>/auth/v1/callback` builder
  use-restart-toast.ts                   NEW — hook: dispatches toast, polls per-instance health, flips toast on success/failure

apps/web/src/lib/
  api.ts                                 MODIFIED — add authConfigApi.{get,patch} typed wrappers
  health-poll.ts                         NEW — small util that polls `GET /v1/projects/:ref` for status==='running' with backoff

apps/web/src/App.tsx                     MODIFIED — wire route `/dashboard/project/:ref/auth/providers`

# ─── Docs ───────────────────────────────────────────────────────────────

docs/changes/
  020-auth-providers.md                  NEW — operator runbook: dashboard tour, per-provider IdP-side setup links, troubleshooting failed restarts
```

**Structure Decision**: Web application (apps/api + apps/web both touched). The three tracks are independent file-set-wise except for:
- Tracks A and C share `apps/api/src/services/env-field-mapper.ts` for the honored-set source-of-truth (Track A defines it, Track C reads from it to determine which form fields to render).
- Track B's coverage check imports the same status map so it can verify per-field assertion coverage.

## Implementation Design

### Track A — Backend field-mapping & transparency

#### A1. Field status map expansion (`apps/api/src/services/env-field-mapper.ts`)

Today the file exports `AUTH_CONFIG_HONORED: Record<string, FieldMapping>` (~17 entries explicitly listed + `oauthProviderEntries()` adding 9 for google/github/azure). We restructure:

```text
type FieldStatus =
  | { kind: 'honored'; envName: string; transform?: (v) => string }
  | { kind: 'stored_only'; reason: string }
  | { kind: 'unsupported'; reason: string };

AUTH_CONFIG_FIELD_STATUS: Record<string, FieldStatus>  // 234 entries, exhaustive
```

Helpers `lookupAuthFieldMapping(name)` and `AUTH_CONFIG_HONORED` re-derived from this single source.

Population:
- **Honored (target 165, range 160–170)**: 24 existing + ~141 new = 17 newly-promoted OAuth providers + Slack OIDC variant (~77 fields) + ~37 mailer (subject to GoTrue image flag-availability — some may reclassify to `stored_only`) + 19 sessions/password/webauthn-rp/passkey/api/db/smtp-misc (one less because `security_manual_linking_enabled` is promoted in foundational T010a) + 7 rate-limit fields. Each entry names its `GOTRUE_*` env var; secret-typed fields tagged for masking.
- **Stored-only (63 total)**: 21 SMS (with `reason: "tracked in #66"`), 21 hooks (`#64`), 10 MFA (`#65`), 3 captcha (`#62`), 2 SAML (`#61`), plus 6 others not yet classified-explicit but in `stored_only` (currently includes a few remaining `mailer_*` that have GoTrue support gaps — TBD during research, see Phase 0).
- **Unsupported (6)**: `oauth_server_*`, `nimbus_*`, `custom_oauth_enabled` — reason `"Cloud-only OAuth server — see #63"`.

Compile-time exhaustiveness: a TS const-assertion using `satisfies Record<keyof UpdateAuthConfigBody, FieldStatus>` so the build fails if a field is missing (paired with the runtime contract test for snapshot refresh drift).

#### A2. GET response extension (`apps/api/src/services/runtime-config-store.ts:getConfig`)

```text
getConfig(ref, 'auth') returns:
  {
    ...redactedAuthConfig,
    _selfbase: {
      fieldStatus: { [fieldName]: { status, reason?, envName? } }
    }
  }
```

The `_selfbase` key is namespaced so unmodified upstream `supabase` CLI consumers ignore it. The field-status map is computed once at module load time from `AUTH_CONFIG_FIELD_STATUS` and reused across requests (zero per-request cost).

The PATCH handler is unchanged — `_selfbase` is read-only / response-only.

#### A3. Snapshot-drift contract test (`apps/api/tests/contract/upstream-auth-config-snapshot.test.ts`)

Loads `specs/009-runtime-config-tunables/upstream-openapi-snapshot.json` (this feature continues to pin against that snapshot until 009 ships a v2), diffs `Object.keys(UpdateAuthConfigBody.properties)` against `Object.keys(AUTH_CONFIG_FIELD_STATUS)`. Asserts the symmetric difference is empty. Fails the build with a clear message naming unclassified fields when the snapshot refreshes.

### Track A — Infra (`infra/supabase-template/docker-compose.yml`)

For each newly-honored field whose env line is commented out (17 OAuth providers + Slack OIDC variant, mailer extras, rate limits, sessions, etc.), uncomment + change the `${VAR}` substitution to use a per-field var that the `runtime-config-store` writes into `.env`. Example for one provider:

```
- # GOTRUE_EXTERNAL_DISCORD_ENABLED: ${DISCORD_ENABLED}
- # GOTRUE_EXTERNAL_DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
- # GOTRUE_EXTERNAL_DISCORD_SECRET: ${DISCORD_SECRET}
- # GOTRUE_EXTERNAL_DISCORD_REDIRECT_URI: ${API_EXTERNAL_URL}/auth/v1/callback

+ GOTRUE_EXTERNAL_DISCORD_ENABLED: ${DISCORD_ENABLED:-false}
+ GOTRUE_EXTERNAL_DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID:-}
+ GOTRUE_EXTERNAL_DISCORD_SECRET: ${DISCORD_SECRET:-}
+ GOTRUE_EXTERNAL_DISCORD_REDIRECT_URI: ${API_EXTERNAL_URL}/auth/v1/callback
```

The `${VAR:-}` default lets the env line exist harmlessly when the var is unset (gotrue interprets empty + `_ENABLED=false` as "provider off").

The 3 already-honored providers (google/github/azure) currently use short env var names (`GOOGLE_ENABLED`); we keep that naming convention for the new 19 to minimize template churn.

### Track B — Behavioral parity test harness

#### B1. `tests/cli-e2e/auth-config-behavioral-parity.sh`

Pseudo-flow:
```
1. Provision (or reuse) a test project on $SELFBASE_APEX
2. Load assertions library; iterate AUTH_CONFIG_HONORED (read via `curl GET ...config/auth | jq '._selfbase.fieldStatus | to_entries[] | select(.value.status=="honored").key'`)
3. For each field:
   a. PATCH `{ [field]: <new test value> }`
   b. Wait for container healthcheck (poll per-instance kong /health, max 60s)
   c. Run the field's assertion (lookup table keyed on field name)
   d. Emit [BEHAVIORAL] FIELD=<name> STATUS=PASS/FAIL ELAPSED=<s>s
4. Restore baseline (or tear down the project)
5. Exit 0 only if all 165 PASS
```

Critically, the loop is **bounded**: container restarts are serialized by the api's distributed lock, so the total wall-clock time is ~165 × ~30s = ~83 min if naively run. Optimizations applied:
- Group fields whose envs co-locate (e.g. all 4 Google fields) into a single PATCH + single restart, then assert each independently.
- Skip restart for fields whose mapping doesn't change `.env` content (no-op deltas).
- Target time: ~10 min on the production VM.

#### B2. Per-field assertions (`tests/cli-e2e/helpers/auth-config-assertions.sh`)

Bash dispatch table keyed on field name. Example assertion patterns:
```
jwt_exp           → request signin → decode JWT → check exp - iat == new value
site_url          → docker exec <ref>-auth env | grep GOTRUE_SITE_URL
external_*_enabled → GET /auth/v1/authorize?provider=<name> → expect 302 to provider domain
mailer_subjects_* → trigger an email (signup) → inspect captured-mail subject
rate_limit_*     → loop request → expect 429 after threshold
sessions_timebox → enroll session → wait → assert session expired
```

The assertion library is structured so adding a new honored field requires adding one row here, with the unit-test coverage check (next section) enforcing it.

#### B3. Coverage check (`apps/api/tests/unit/env-field-mapper.test.ts`)

Parses the assertion library to extract its dispatch keys. Compares against the honored set. Fails if any honored field has no entry, or any assertion entry has no corresponding honored field.

### Track C — Dashboard Auth Providers page

#### C1. Sheet primitive (`apps/web/src/components/ui/sheet.tsx`)

Standard shadcn Sheet (Radix Dialog + slide-in animation). Adds the dep on `@radix-ui/react-dialog` to `apps/web/package.json` if not present.

#### C2. Provider registry (`apps/web/src/pages/auth-providers/provider-registry.ts`)

A const array of 25 entries:
```text
{ key, displayName, icon, status: 'active'|'coming-soon', formTemplate: 'CommonFour'|'PlusUrl'|...,
  fieldMap: { enabled: 'external_<x>_enabled', clientId: 'external_<x>_client_id', ... },
  comingSoonIssue?: number, callbackUrlFn: (ref, apex) => string }
```

Special cases:
- Slack rendered as 2 rows (slack-deprecated + slack-oidc)
- Email + Phone rendered as toggle-only (no drawer; status pill flips on simple PATCH)
- SAML / Web3 / Custom Providers: `status: 'coming-soon'` with `comingSoonIssue: 61|72|63`

#### C3. Page (`apps/web/src/pages/ProjectAuthProviders.tsx`)

Layout:
```
<ProjectShell title="Auth Providers" subtitle="...">
  <GlobalTogglesForm />         ← top 4 toggles + Save changes
  <ProvidersList>
    {registry.map(provider => provider.status === 'coming-soon'
      ? <ComingSoonRow />
      : <ProviderRow onClick={openDrawer(provider)} />)}
  </ProvidersList>
  <Sheet open={!!activeProvider} onOpenChange={closeDrawer}>
    {activeProvider && <FormTemplateFor provider={activeProvider} />}
  </Sheet>
</ProjectShell>
```

Drawer opens via state OR via `?provider=<Name>` querystring (initialized from URL on mount).

#### C4. Restart-toast orchestration (`use-restart-toast.ts`)

```text
function useRestartToast(ref) {
  return async function save(patchBody) {
    const id = toast.loading('Restarting auth — your changes will be live in ~30s');
    closeDrawer();
    try {
      await authConfigApi.patch(ref, patchBody);
      await pollUntilHealthy(ref, { timeoutMs: 60_000 });
      toast.success('Settings applied', { id });
      refetchAuthConfig();  // refresh status pills
    } catch (err) {
      toast.error('Restart failed — try again', { id, action: { label: 'Retry', onClick: () => save(patchBody) } });
    }
  };
}
```

`pollUntilHealthy` lives in `apps/web/src/lib/health-poll.ts`; uses exponential backoff (500ms / 1s / 2s / 4s caps) and reads `GET /v1/projects/:ref` for `status === 'running'`.

#### C5. RBAC enforcement

`useAuth()` hook (already exists) returns the user's role. Page reads it; if not admin, hides all Save buttons and disables form fields. Server-side enforcement is already in place (`auth_config.write` action on PATCH).

### Operator runbook (`docs/changes/020-auth-providers.md`)

- Tour of the new Auth → Providers page (screenshots from supaviser.dev)
- Per-provider IdP-side setup links (Google Cloud Console URL, GitHub OAuth App URL, Discord Developer Portal URL, …)
- The 30s restart window — what's expected, what to do if it fails
- How to read the `_selfbase.fieldStatus` in API responses for SREs
- Troubleshooting: provider says enabled but `/auth/v1/authorize` returns 400 → check IdP-side configuration (callback URL mismatch is the #1 cause)

## Phase 0: Outline & Research

Open questions that block design lock — research outputs go to `research.md`:

1. **GoTrue env-var names for the 17 OAuth providers + Slack OIDC variant + mailer extras + rate limits + sessions.** Source: upstream `gotrue` repo's `internal/conf/configuration.go` (env-var struct tags). Need to confirm names match what selfbase's pinned image (current `supabase/gotrue:vX.Y.Z`) actually reads. Risk: a couple of older `mailer_notifications_*` fields may have GoTrue support gaps that force them into `stored_only` instead of `honored`. Output: the authoritative list of ~141 (env → selfbase field) mappings.

2. **Slack legacy-vs-OIDC field naming.** Upstream uses `external_slack_*` (legacy) and `external_slack_oidc_*` (current). Need to confirm the env-var naming GoTrue expects for the OIDC variant (`GOTRUE_EXTERNAL_SLACK_OIDC_*`?). Output: the right env names for both Slack rows.

3. **Container healthcheck endpoint for per-instance auth.** What URL does the dashboard poll to know the new env was picked up — the per-instance `/auth/v1/health`? The kong `/health` route? The control-plane's `GET /v1/projects/:ref` status field? Output: the endpoint + the expected response.

4. **Callback URL for self-hosted GitLab / Keycloak / Azure variants.** Cloud's drawer renders a URL field for these because the IdP is operator-hosted. We still need to surface a callback URL — but it's the same `https://<ref>.<apex>/auth/v1/callback` for all of them. Confirm no additional callback variants are needed. Output: callback URL is canonical and provider-independent.

5. **The 4th top-of-page toggle.** Spec names `allow_manual_linking`; the field in upstream is `security_manual_linking_enabled` (under `security_*`, not a top-level field). Confirm the field name + whether it's currently honored or needs promotion.

Each item resolved in `research.md` with **Decision / Rationale / Alternatives considered** triplets. All 5 are concrete and time-boxable (~30min each); no `[NEEDS CLARIFICATION]` markers in the spec require user input.

## Phase 1: Design & Contracts

### `data-model.md`

- `AUTH_CONFIG_FIELD_STATUS` — the 234-entry status map (typed shape, plus excerpt examples)
- Provider row definition (`provider-registry.ts` shape)
- Drawer state machine (states: closed / opening / open / saving / restarting / success / failure)
- GET response shape with `_selfbase` extension (JSON example)
- No new DB entities

### `contracts/auth-config-get-response.md`

Specifies the augmented GET response shape. JSON example showing every classification kind. CLI-compat statement (unmodified `supabase` ignores `_selfbase`).

### `contracts/provider-form-templates.md`

Per-provider form-field tables (A/B/C/D-google/D-apple/E variants), the exact `external_*` field each input maps to, validation rules per field (e.g. `additional_client_ids` is comma-separated), and the callback URL formula.

### `quickstart.md`

Operator-facing smoke tests:
1. Login as admin → open `Auth → Providers` → enable GitHub → IdP roundtrip succeeds
2. Same flow for 2 other providers (parameterizable)
3. PATCH `mailer_subjects_invite` via CLI → trigger an invite → email arrives with new subject
4. PATCH `rate_limit_email_sent` to 1/min → trigger 2 mails → second returns 429
5. GET auth-config via CLI → confirm `_selfbase.fieldStatus` shape

Plus the agent-context update: replace the `<!-- SPECKIT START -->` … `<!-- SPECKIT END -->` block in `CLAUDE.md` to point at `specs/020-auth-providers-dashboard/plan.md`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Dashboard reuses the `/v1/*` Management API directly instead of going through an `/api/v1/*` wrapper (the convention split documented in CLAUDE.md) | The Management API endpoint is the exact shape the dashboard needs — same RBAC action, same validation, same audit log, same response. A wrapper would duplicate all four and add a translation layer for zero benefit. | A new `/api/v1/projects/:ref/auth/providers` endpoint would duplicate Zod parsing of all 234 fields, re-emit the same audit event, and need its own RBAC mapping back to `auth_config.write`. Splitting would create two routes to keep in sync with every upstream snapshot refresh. |
| Multiple provider-form components instead of one generic form driven by a schema | Five form templates exist (Common-4, +URL, +URL-no-email, Google-extras, Apple-extras, OIDC-prefix). The provider-specific extras (Google's `skip_nonce_check`, Apple's `additional_client_ids`, WorkOS dropping `email_optional`) are too divergent to drive cleanly from a single schema without polluting each provider's UX with conditional rendering. | A single `<DynamicForm fields={...} />` would work for the 16 Common-4 providers but force special-case `if (provider === 'google')` branching for the remaining 6. Splitting into 5 small files keeps each provider's form readable in one screen. |
