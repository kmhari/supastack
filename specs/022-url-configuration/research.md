# Phase 0 Research: URL Configuration page

**Date**: 2026-05-28
**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md)

This document resolves deferred items from `/speckit-clarify` and documents the small set of best-practice decisions that inform the design.

---

## R1 — Wildcard pre-flight validation

**Decision**: Accept wildcard tokens (`*`, `**`, `?`) anywhere in the path/query and validate URL shape by replacing them with a placeholder before passing to `new URL()`. Do NOT validate the wildcard pattern syntax itself.

**Rationale**:
- The wildcard syntax is GoTrue's responsibility; it uses a glob-matching library that we don't want to second-guess client-side.
- Operators copy/paste patterns from docs; if we reject a pattern we don't recognize, we block them from configuring a setup that GoTrue would have accepted.
- The cost of accepting a bad pattern is bounded: the auth container will fail healthcheck after restart, the operator sees a red restart toast with Retry, they delete the bad entry.

**Implementation**:
```ts
function looksLikeValidUrl(input: string): boolean {
  if (!input || /\s/.test(input)) return false;
  // Replace glob tokens with safe placeholder so URL() doesn't choke
  const placeholder = input
    .replace(/\*\*/g, 'glob2')
    .replace(/\*/g, 'glob1')
    .replace(/\?/g, 'glob3');
  try {
    const u = new URL(placeholder);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
```

**Alternatives considered**:
- *Strict glob parser*: bring in `picomatch` or write a regex. Adds 30+ lines for no real benefit (GoTrue does this anyway).
- *No validation*: accept any string. Rejected because we lose the cheap win of catching schemes like `javascript:` and `data:` that should never be in an allow list.

---

## R2 — Docs link target

**Decision**: Link to `https://supabase.com/docs/guides/auth/redirect-urls` (Cloud's docs URL, matching what their dashboard does).

**Rationale**:
- We have no self-hosted docs site.
- Cloud's docs are correct for selfbase too — wildcard syntax and SITE_URL semantics are GoTrue behavior, identical between Cloud and self-hosted.
- Matching the link target also matches the visual (the rendered button is identical).

**Alternatives considered**:
- *Omit the Docs link entirely*: rejected — Cloud has it, visual parity requires us to have it.
- *Link to a selfbase-specific runbook*: nothing to write yet; we'd be creating a docs page just to satisfy this link.

---

## R3 — RBAC action reuse

**Decision**: Reuse the existing `auth.update` RBAC action that the Auth Providers PATCH already uses. No new action.

**Rationale**:
- Same endpoint (`PATCH /api/v1/projects/:ref/config/auth`).
- Same threat model (admin can change auth behavior; member cannot).
- Splitting into `auth.update_url_config` would be over-segmentation — operators don't grant URL-config write but withhold provider write, or vice versa.

**Verification**: `packages/shared/src/rbac.ts` already grants admin write on `auth.update` and denies member. Member sees read-only state via the same gating UI pattern.

---

## R4 — Validation library choice

**Decision**: Use the WHATWG `URL` constructor (built into modern browsers and Node). No new dependency.

**Rationale**:
- Already used elsewhere in selfbase web code.
- Zero install cost.
- The wildcard-tolerance trick (R1 placeholder replacement) lets us reuse it without modification.

**Alternatives considered**:
- `valid-url` npm: stale (last published 2014), no TypeScript types out of the box.
- `is-url-superb`: 2KB minified — fine, but unnecessary when `new URL()` works.
- Zod URL schema: heavier than needed for a single client-side check.

---

## R5 — CSV encoding for uri_allow_list

**Decision**: Comma-separated string with leading/trailing whitespace trimmed per entry. Match GoTrue's env-var consumption format exactly.

**Rationale**:
- GoTrue reads `GOTRUE_URI_ALLOW_LIST` as a comma-separated string. Selfbase env-field-mapper writes `ADDITIONAL_REDIRECT_URLS` (compose maps to `GOTRUE_URI_ALLOW_LIST`) as the same comma-separated string. Anything fancier (JSON array, newline-separated) would require backend changes.
- URLs in the allow list are operator-typed and operator-readable; commas inside path/query segments are usually percent-encoded in real-world URLs. The breakage envelope for unencoded commas is narrow and known.

**Edge case**: `uri_allow_list = ""` (empty string) — split yields `[""]`, after `filter(Boolean)` yields `[]`. Round-trips correctly.

---

## R6 — Dialog state vs query-param state

**Decision**: Dialog open/close state is local React state in `ProjectAuthUrlConfig`. Unlike the Auth Providers drawer (which uses `?provider=<name>` for deep-linking), the Add Redirect URLs dialog has no shareable state worth deep-linking.

**Rationale**:
- The dialog is a transient batch-add UX; a partially-typed batch is not worth restoring on URL revisit.
- Cloud also does not deep-link the dialog.

**Out of scope**: deep-linking individual list entries for highlighting (could be added later if desired; nothing in the spec asks for it).

---

## R7 — Existing-project handling (confirmation from clarify Q4)

**Decision**: Reaffirmed — do not seed, do not migrate, do not auto-fill `site_url`. Empty Site URL input is the correct state on first page load for any project that has never set it. The operator types their app URL once.

**Rationale**: `site_url` is the operator's frontend application URL (e.g. `https://app.example.com`). Selfbase cannot guess it. Auto-defaulting to the project's kong URL would silently break email-confirmation links by sending users to the supaviser.dev kong host instead of the operator's app.

---

## R8 — Test strategy

**Decision**:
- Vitest unit tests for `redirect-url-helpers.ts` (split/join/dedup/validate) — covers algorithm edge cases without DOM.
- Vitest component tests for `ProjectAuthUrlConfig` — admin vs member rendering, validation rejection paths.
- Playwright e2e (`url-configuration.spec.ts`) — full save+reload, deep-link, RBAC.
- Manual screenshot diff against Cloud captured 2026-05-28.

**Rationale**:
- Helpers are pure functions — unit-testable without React.
- Component tests catch rendering regressions; helper tests catch logic regressions independently.
- Browser tests catch what jsdom misses (feature 021's whole motivation).

**Alternatives considered**:
- *Skip Vitest helper test and rely on Playwright only*: rejected — Playwright is slow for combinatorial logic checks; helper unit tests run in milliseconds.

---

## R9 — Deferred to follow-ups (not blocking this feature)

| Item | Why deferred | Issue/owner |
|---|---|---|
| Link from OAuth provider drawers ("Add this provider's callback URL to the allow list" CTA) | Nice-to-have polish; not required for unblock | Open as follow-up issue post-merge |
| Custom-domain CNAME setup | Larger workstream, not auth-config related | Pre-existing backlog |
| Auto-suggest `http://localhost:<port>` for dev | Speculative; operator typing is fine | Defer until a real request surfaces |
| URL Configuration via Mgmt-API (`supabase ssl-enforcement` etc.) | Tier-3 CLI work; tracked in CLAUDE.md open work | #12 (existing) |
| Newline / batch import for allow list | Speculative; not on Cloud | Defer |

---

## Open question for `/speckit-tasks`

None. All clarifications resolved, all deferred items have explicit decisions.
