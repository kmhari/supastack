# Implementation Plan: URL Configuration page

**Branch**: `022-url-configuration` (spec-only; will branch off main when 021 PR merges)
**Date**: 2026-05-28
**Spec**: [`spec.md`](./spec.md)
**Clarifications**: 4 resolved in [Session 2026-05-28](./spec.md#clarifications)

## Summary

Add a `/dashboard/project/<ref>/auth/url-configuration` page that mirrors Supabase Cloud's URL Configuration page: a Site URL section (single input, Save changes button) and a Redirect URLs section (allow-list, batch-add modal dialog, per-entry delete). Backend already honors `site_url` → `SITE_URL` and `uri_allow_list` → `GOTRUE_URI_ALLOW_LIST` (env-field-mapper.ts:66-67), so this feature is **dashboard-only** — no API changes, no migrations, no provisioning changes. Implementation reuses feature 020's `use-restart-toast` polling utility, feature 020's Sheet/Dialog primitives, and feature 021's `EXPECTED_PAGES` registry.

## Technical Context

**Language/Version**: TypeScript 5.6 (web), TypeScript 5.6 (api unchanged)
**Primary Dependencies**: React 18.3, react-router-dom 6.26, @tanstack/react-query 5.x, Radix Dialog 1.1, Tailwind 4.1 (all already in `apps/web/package.json` — no new deps)
**Storage**: Existing per-project `auth_config` columns + per-instance `.env`. No schema changes.
**Testing**: Vitest (component + helpers), Playwright (e2e via feature 021's harness)
**Target Platform**: Selfbase dashboard SPA served by Caddy, modern browsers
**Project Type**: Web (frontend-only feature against existing api)
**Performance Goals**: Page load < 200ms after auth-config query resolves (same envelope as Auth Providers page)
**Constraints**: Match Cloud screenshot at 1440px viewport; reuse Auth Providers' restart-toast UX; cap allow-list at 50 entries; admin-only writes
**Scale/Scope**: One new page (~200 LOC), one new dialog component (~150 LOC), one e2e spec (~80 LOC), minimal helpers (~80 LOC)

## Constitution Check

The project constitution at `.specify/memory/constitution.md` is a placeholder template (unfilled). No enforceable gates to evaluate. Applying project-implicit conventions instead (these mirror conventions used by features 020 + 021, which shipped successfully):

| Gate | Status | Note |
|---|---|---|
| Idempotent migrations | N/A | No DB migrations needed |
| Schema additivity | N/A | No schema changes |
| Master-key envelope encryption | N/A | No new secrets (site_url + uri_allow_list are non-secret strings) |
| RBAC matrix updated | ✓ | Reuses existing `auth.update` action (no new action needed — same PATCH endpoint as feature 020 providers) |
| Spec-driven workflow | ✓ | Following `/speckit-{specify,clarify,plan,tasks,implement}` |
| One concern per worker job | N/A | No new worker jobs |
| Dashboard at `/api/v1/*` + Mgmt-API at `/v1/*` separation | ✓ | Reuses existing `PATCH /api/v1/projects/:ref/config/auth` (dashboard) — no `/v1/*` changes |
| Mgmt-API source of truth = upstream OpenAPI snapshot | N/A | This feature is dashboard-only; no Mgmt-API endpoints affected |
| Page-coverage registry updated | ✓ | Will add `ProjectAuthUrlConfig` to `apps/web/tests/e2e/expected-pages.ts` |

**No violations.** Complexity Tracking section omitted (no waivers needed).

## Project Structure

### Documentation (this feature)

```text
specs/022-url-configuration/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── url-config-ui.md # Frontend UI contract (the only "contract" here is the page surface)
├── checklists/
│   └── requirements.md  # Created by /speckit-specify; already passing
└── tasks.md             # Created by /speckit-tasks (next phase)
```

### Source Code (repository root)

```text
apps/web/
├── src/
│   ├── pages/
│   │   ├── ProjectAuthUrlConfig.tsx               # NEW — page component
│   │   └── auth-url-config/                       # NEW — page-local subdir (mirroring auth-providers/)
│   │       ├── SiteUrlForm.tsx                    # NEW — Site URL section
│   │       ├── RedirectUrlsList.tsx               # NEW — Redirect URLs list + delete handlers
│   │       ├── AddRedirectUrlsDialog.tsx          # NEW — Modal with batch-add rows
│   │       └── redirect-url-helpers.ts            # NEW — split/join/dedup/validate utilities
│   ├── components/ProjectShell.tsx                # MODIFIED — add "URL Configuration" sidebar item
│   └── App.tsx                                    # MODIFIED — add route
└── tests/
    ├── e2e/
    │   ├── url-configuration.spec.ts              # NEW — Playwright spec
    │   └── expected-pages.ts                      # MODIFIED — register new page
    └── unit/
        ├── ProjectAuthUrlConfig.test.tsx          # NEW — component test
        └── redirect-url-helpers.test.ts           # NEW — helper unit tests

# No backend changes. No spec changes downstream. No infra changes.
```

**Structure Decision**: Mirror feature 020's layout (`pages/<feature>/` subdirectory for page-local components + a single page component at `pages/Project<Feature>.tsx`). Helpers live in a single `redirect-url-helpers.ts` because the logic (split/join CSV, dedup with scheme+host lowercase, validate URL shape with wildcard tolerance) is shared between `RedirectUrlsList` (for delete-dedup) and `AddRedirectUrlsDialog` (for add-validate). Component test covers happy path; helper unit test covers normalization edge cases. E2E covers full save+reload cycle.

## Implementation Notes

### Reuse vs. New

| Concern | Reuse | New |
|---|---|---|
| Auth-config fetch (GET `/api/v1/projects/:ref/config/auth`) | ✓ existing query in `lib/api.ts` | — |
| Auth-config PATCH | ✓ existing mutation in `lib/api.ts` | — |
| Restart toast | ✓ `use-restart-toast.ts` from feature 020 | — |
| Sheet/Dialog primitives | ✓ from feature 020 | Compose into `AddRedirectUrlsDialog` |
| Form inputs (`Input`, `Label`, `Button`) | ✓ shadcn primitives | — |
| RBAC gate (admin-only writes) | ✓ existing `useAuth().user.role === 'admin'` pattern | — |
| Page shell (sidebar + title + subtitle) | ✓ `ProjectShell` | Add new sidebar entry |
| Route registration | ✓ `App.tsx` patterns from `ProjectAuthProviders` | Add route |
| Page-coverage lint | ✓ `EXPECTED_PAGES` registry | Register new page |
| Playwright fixtures (admin/member sessions) | ✓ feature 021 fixtures | — |

### Why Dialog instead of Sheet

The Auth Providers drawer uses `Sheet` (right-side slide-in) because each provider has many fields. Add Redirect URLs is a focused, batch-add operation with at most a URL input per row — Cloud uses a centered `Dialog`, smaller footprint, modal interaction model. We mirror that exactly.

### Validation rules (consolidated from clarifications)

1. **Site URL**: must parse with WHATWG `URL` constructor, scheme ∈ `{http, https}`; reject empty/whitespace-only client-side (Save button disabled).
2. **Redirect URL**: scheme ∈ `{http, https}`; path/query may contain glob characters `*`, `**`, `?`; reject `javascript:`, `data:`, `file:`. Wildcard tolerance achieved by replacing wildcard sequences with a placeholder token (`__GLOB__`) before `new URL()` parse, then accepting if parse succeeds with allowed scheme. (See research.md for the explored alternatives.)
3. **Dedup**: comparison string = `scheme.toLowerCase() + '://' + host.toLowerCase() + path + (search ? '?' + search : '')`. Path and query stay byte-exact so `/foo` ≠ `/foo/`.
4. **Cap**: 50 entries. Add button + dialog Save URLs button disabled when cap reached or merge would exceed cap.

### Data flow

```
Operator opens page
    ↓
GET /api/v1/projects/:ref/config/auth → { site_url, uri_allow_list, … }
    ↓
SiteUrlForm seeds state from site_url
RedirectUrlsList seeds state from uri_allow_list.split(',').map(trim).filter(Boolean)
    ↓
[Operator edits Site URL → Save]
    ↓
PATCH { site_url: <new> } → restart toast polls health
    ↓
[Operator clicks Add URL → dialog opens]
    ↓
Dialog state holds an array of { id, value } rows
    ↓
[Operator types in row 1, clicks "+ Add URL" → row 2 appended]
    ↓
[Operator clicks Save URLs]
    ↓
Filter empty rows + validate each + dedup against existing list
    ↓
PATCH { uri_allow_list: [...existing, ...newRows].join(',') } → restart toast polls
    ↓
[Operator clicks trash on a list entry]
    ↓
PATCH { uri_allow_list: existing.filter(u => u !== target).join(',') } → restart toast polls
```

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| Restart toast loops on auth health-check timeout | Already battle-tested by feature 020; reuse as-is |
| Operator pastes a glob pattern that GoTrue rejects → auth container fails healthcheck | Out of scope per research.md R1; if it happens, the restart toast flips to Retry and the operator can delete the bad entry |
| `uri_allow_list` CSV parsing edge cases (commas in URLs, whitespace around commas) | RFC 3986 URLs cannot contain commas in scheme/host/port; in path/query commas are typically percent-encoded. We `.split(',').map(s => s.trim()).filter(Boolean)` which handles operator-typed whitespace. If a URL legitimately contains an unencoded comma in the path, that's an edge case operators handle by percent-encoding; we do not introduce a fancier list encoding |
| Operator with active OAuth flow during save → temporary 502 | The 30s restart toast warns of in-progress restart; same UX as Auth Providers |
| Visual drift from Cloud as Cloud iterates | Acknowledged; we match the screenshot captured on 2026-05-28. Future Cloud iterations may diverge — not a blocker |

## Implementation Phases (anticipated for `/speckit-tasks`)

### Phase 1: Setup
- Register page in `EXPECTED_PAGES` (test-driven: lint will fail until phase 3 lands)
- Add route to `App.tsx` (stub component renders title)

### Phase 2: Foundational (no story-bound work)
- `redirect-url-helpers.ts` with split/join/dedup/validate + unit tests
- `ProjectShell.tsx` sidebar entry

### Phase 3: User Story 1 — Set Site URL (P1)
- `SiteUrlForm.tsx`
- Component test (admin can save, member sees disabled)
- Wire into `ProjectAuthUrlConfig.tsx`

### Phase 4: User Story 2 — Add and remove Redirect URLs (P1)
- `RedirectUrlsList.tsx` (delete handler)
- `AddRedirectUrlsDialog.tsx` (batch-add)
- Component tests
- Wire into `ProjectAuthUrlConfig.tsx`

### Phase 5: User Story 3 — Visual parity (P2)
- Manual screenshot-diff session against captured Cloud reference
- Tighten section spacing / button placement / empty-state copy to match

### Phase 6: User Story 4 — Sidebar + deep-link (P3)
- Already done in Phase 2 sidebar entry; verify deep-link via Playwright

### Phase 7: Polish & cross-cutting
- `url-configuration.spec.ts` Playwright (covers FR-013)
- Live-VM smoke: deploy to supaviser.dev, save Site URL, add 3 Redirect URLs incl. `http://localhost:8765/**`, retry the OAuth tester from `scripts/oauth-test/index.html`, verify GoTrue honors the localhost redirect

## Artifacts produced this phase

| Artifact | Purpose |
|---|---|
| [`plan.md`](./plan.md) | This file |
| [`research.md`](./research.md) | Deferred-item decisions (wildcard pre-flight, Docs link, RBAC reuse), best-practice notes |
| [`data-model.md`](./data-model.md) | View-model shapes + validation rules + storage encoding |
| [`contracts/url-config-ui.md`](./contracts/url-config-ui.md) | Page contract: route, query params, RBAC, state machine, accessibility |
| [`quickstart.md`](./quickstart.md) | Live-VM smoke script |
