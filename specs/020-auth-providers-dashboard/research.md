# Phase 0 Research: Auth Providers Dashboard + Behavioral Parity

**Feature**: 020-auth-providers-dashboard | **Date**: 2026-05-28

Resolves the 5 open questions identified in `plan.md`. Each entry: **Decision / Rationale / Alternatives**.

---

## R-001: GoTrue env-var names for the 141 newly-honored fields

**Decision**: Map each promoted field to its `GOTRUE_*` env-var as documented in upstream `gotrue`'s `internal/conf/configuration.go` struct tags. The selfbase template uses two naming conventions side-by-side: full `GOTRUE_*` names (preferred for new fields) and shortened legacy aliases (`GOOGLE_ENABLED` → `GOTRUE_EXTERNAL_GOOGLE_ENABLED`) for the 3 already-wired providers. We keep the legacy short-alias pattern for the 3 existing providers (no churn) and use full names for the 19 new providers + 37 mailer + 7 rate-limit + 20 sessions/password/webauthn-rp/passkey/api/db/smtp-misc fields.

**Rationale**: Pinning to a single GoTrue version (`supabase/gotrue:vX.Y.Z`, exact tag in `infra/supabase-template/versions.md`) means env-var names are stable. A few `mailer_notifications_*` fields (introduced in recent GoTrue versions) may not be present in the pinned image; those flip from `honored` to `stored_only` with a `reason: "requires GoTrue image bump — see #65"`. Final count of `honored` may land at 160–165 depending on the image-vs-flag check during implementation (tracked as a TODO in tasks.md, not a spec change — the SC-003 target of 165 has a ±5 tolerance documented here).

**Alternatives considered**:
- Bumping the pinned GoTrue image as part of this feature → rejected; tracked in #65; bump touches MFA + webauthn semantics that need their own e2e coverage.
- Honoring every field and ignoring image-version reality → rejected; status map must reflect runtime truth (Edge Cases bullet in spec).

---

## R-002: Slack legacy-vs-OIDC env-var naming

**Decision**: Legacy `external_slack_*` → `GOTRUE_EXTERNAL_SLACK_*`. OIDC `external_slack_oidc_*` → `GOTRUE_EXTERNAL_SLACK_OIDC_*`. The dashboard renders two separate rows in the provider list; each has its own drawer. Both rows are admin-editable. Cloud marks the legacy row "Deprecated"; we mirror that label.

**Rationale**: GoTrue ≥ v2.x supports both env families simultaneously and treats them as independent providers. Existing operator deployments using legacy Slack continue to work; new deployments should pick OIDC.

**Alternatives considered**:
- Hiding the legacy row → rejected; operators with existing Slack OAuth apps need to keep using them until they re-register.
- Auto-migration prompt → rejected; out of scope and would mislead operators who deliberately chose legacy.

---

## R-003: Container healthcheck endpoint for restart-toast polling

**Decision**: Poll the control-plane `GET /v1/projects/:ref` endpoint and read its `status` field; the dashboard toast flips to success when `status === 'running'` AND the per-instance kong's `/auth/v1/health` returns 200 within the same poll window. Use exponential backoff: 500ms, 1s, 2s, 4s (cap), max 60s total before timing out.

**Rationale**: The per-instance auth container's `/auth/v1/health` is exposed via kong at `https://<ref>.<apex>/auth/v1/health` and is fast (< 50ms when healthy). The control-plane status is the authoritative selfbase-side signal; combining both protects against the race where docker says the container is up but GoTrue's HTTP server hasn't bound yet.

**Alternatives considered**:
- Poll only `/auth/v1/health` → rejected; doesn't catch the case where the container failed to start and selfbase already marked it `errored`.
- Poll only the control-plane status → rejected; the status flips to `running` as soon as docker reports healthy, which can be a few seconds before GoTrue actually serves requests.
- Server-sent events / websocket → rejected; overkill for a 30s poll; the api doesn't have an SSE harness today.

---

## R-004: Callback URL canonicalization for all OAuth providers

**Decision**: Every provider's callback URL is `https://<ref>.<apex>/auth/v1/callback`. There are no per-provider variants. The dashboard's Callback URL field is read-only and prefilled from the project's `ref` + the control-plane's configured apex (already available client-side via the existing project context).

**Rationale**: GoTrue routes all provider callbacks to the same single `/auth/v1/callback` route and disambiguates by query-string `state`. This is independent of whether the IdP is operator-hosted (GitLab self-hosted, Keycloak) or vendor-hosted (Google, Discord). The operator-hosted variants need an additional input — the IdP's base URL — but that's the `url` form field on the +URL templates (B, C), not a callback URL variant.

**Alternatives considered**:
- Per-provider callback paths (e.g. `/auth/v1/callback/discord`) → rejected; not how GoTrue is configured; would break upstream-CLI compat for users mixing CLI + dashboard.
- Allowing the operator to edit the callback URL → rejected; this is a deployment-derived value, not a user choice; editing it would break the IdP roundtrip silently.

---

## R-005: `allow_manual_linking` field name and current status

**Decision**: The top-of-page toggle "Allow manual linking" maps to the upstream field `security_manual_linking_enabled` (not a top-level `allow_manual_linking`; the spec used Cloud's display label). Today this field is in the `stored_only` bucket (it falls through to the default in `lookupAuthFieldMapping`). This feature promotes it to `honored` by mapping to `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`. The top-of-page bundle therefore touches three already-honored fields (`disable_signup`, `external_anonymous_users_enabled`, `mailer_autoconfirm` — note the inverse semantics for "Confirm email" maps to `!mailer_autoconfirm`) plus this newly-promoted one.

**Rationale**: GoTrue ≥ v2.x supports manual linking via env var; it's enabled by default off. Promoting it is a pure mapping-table addition + template uncomment (the env line is present in the template's commented-out `security_*` block, no new compose entry needed).

**Alternatives considered**:
- Keeping `security_manual_linking_enabled` as `stored_only` and hiding the toggle → rejected; Cloud parity demands the toggle, and the promotion is free.
- Adding `allow_manual_linking` as a selfbase-only alias → rejected; would diverge from the upstream contract that `supabase config update` already exercises.

---

## Out-of-research items (deferred to implementation discovery)

- **Provider icons** — Cloud uses provider SVG/PNG assets. Decision deferred to dashboard implementation; default is to reuse upstream's icon set from `@supabase/icons` or equivalent. If license forbids, fall back to generic icons + provider name text. Not a spec gate.
- **Exact secret-reveal pathway** — FR-016 says "explicit admin-only fetch". Implementation chooses between (a) a new `GET /v1/projects/:ref/config/auth?reveal=external_google_secret` query param or (b) reusing feature 010's vault-reveal pattern. Decision tracked in tasks.md, not blocking spec/plan.
- **Operator survey for SC-009** — Mechanism (in-dashboard nudge? quarterly email? GitHub discussion?) deferred to post-ship operator-comms decision. Acceptance is the survey question itself, not the response rate at merge time.
