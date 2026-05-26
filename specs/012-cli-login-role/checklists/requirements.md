# Specification Quality Checklist: CLI login-role — passwordless `supabase db push`

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-25
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs)
- [X] Focused on user value and business needs
- [X] Written for non-technical stakeholders
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous
- [X] Success criteria are measurable
- [X] Success criteria are technology-agnostic (no implementation details)
- [X] All acceptance scenarios are defined
- [X] Edge cases are identified
- [X] Scope is clearly bounded
- [X] Dependencies and assumptions identified

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria
- [X] User scenarios cover primary flows
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

## Validation findings (initial pass)

| Item | Status | Notes |
|------|--------|-------|
| No implementation details | PASS with caveat | Spec necessarily names a small number of concrete artifacts that are part of the **contract** with the upstream CLI (the endpoint path `POST /v1/projects/{ref}/cli/login-role`, the request/response shape, role-name prefix `cli_`, Postgres error code 42501). These are wire-level realities the CLI client already speaks against Cloud — they constrain *what* selfbase must produce, not *how* selfbase produces it. The plan phase will turn each into an implementation choice. No language/framework names appear; no internal file paths or class names appear except in the Assumptions section where `per-instance-pg.ts` is cited as an existing-system reference. |
| Focused on user value | PASS | Every requirement traces to a user-observable outcome (no password prompt, no behavioural regression, no leftover roles, defense-in-depth on read-only). |
| Written for non-technical stakeholders | PASS with caveat | The "Postgres role" and "PAT" terms are unavoidable because the value proposition itself is about credentials. Glossary-style framing is implicit in the prose. |
| All mandatory sections completed | PASS | User scenarios, requirements, success criteria, assumptions all present. Edge cases included inline under user scenarios. |
| No [NEEDS CLARIFICATION] markers remain | PASS | None used. One deliberate deferred decision is flagged inline (FR-005 grant set "to be pinned in plan.md after a side-by-side capture from a Cloud project") — this is an implementation detail belonging to the plan phase, not a scope question for the spec. |
| Requirements testable and unambiguous | PASS | Each FR has a verifiable post-condition. FR-007 ("unguessable") is operationalised in SC-005 via entropy analysis. FR-008 ("schedule short enough that no leftover rows appear within an hour") is operationalised in SC-003. |
| Success criteria measurable | PASS | Every SC names what is measured, how, and what the pass threshold is. No bare adjectives. |
| Success criteria technology-agnostic | PASS with caveat | SC-004 cites Postgres error code 42501 (permission denied) and SC-005 cites `db.<ref>.<apex>:5432` and `pg_hba`. These are the contract surface — not implementation choices — because the value of the feature is precisely "the role is enforced at the Postgres level". Calling out the error code is what makes the criterion verifiable; using a "user-facing" abstraction here would be vaguer, not more user-focused. |
| Acceptance scenarios defined | PASS | Every user story has at least two Given/When/Then scenarios. |
| Edge cases identified | PASS | Eight enumerated, covering RBAC denial, token revocation, project not running, name collisions, clock skew, reaper outage, password precedence, and concurrent invocations. |
| Scope bounded | PASS | Out-of-scope items are explicit (no new client-side credential type, no `supabase link` UX redesign, no IPv6/pooler routing changes, no OAuth-token-based PG auth — the last three are in the issue's "Out of scope" section). |
| Dependencies & assumptions identified | PASS | Eight assumptions enumerated, including the relationship to features 004, 005, 011 and the upstream CLI binary's resolution logic being the source of truth. |
| Functional requirements have clear acceptance | PASS | Each FR cross-references at least one SC or acceptance scenario. |
| User scenarios cover primary flows | PASS | Four prioritised stories (P1 × 2, P2, P3) cover the new flow, the legacy flow, read-only enforcement, and graceful cleanup. |
| Measurable outcomes met | PASS | Seven SCs covering UX (SC-001, SC-006), regression (SC-002, SC-007), hygiene (SC-003), security (SC-004, SC-005). |
| No implementation details leak | PASS with caveat as above | The handful of wire-level identifiers present are contract surface, not implementation choices. |

### Overall

Ready for `/speckit-plan`.

### Clarifications session 2026-05-25 (post `/speckit-clarify`)

Four questions asked, four answered, four integrated. Spec rewritten mid-session after upstream verification revealed that the originally proposed architecture (per-call ephemeral roles + background reaper + dashboard_user template) diverged from how Cloud actually implements the feature (persistent per-project `cli_login_*` role + password rotation + `IN ROLE postgres` + runtime `SET SESSION ROLE`). The new spec matches Cloud's actual implementation behaviour as documented in upstream PR #3885 (`feat: password-less database login`, merged 2025-07-21) and the current `internal/utils/flags/queries/role.sql` template.

Clarifications recorded (in order asked):
1. TTL = 300 seconds (5 min) — confirmed against upstream tests + SQL template.
2. Role architecture = persistent fixed-name role + rotating password (NOT ephemeral per-call roles) — confirmed against upstream `role.sql` + `connect.go:201-220`.
3. Rate limit = 30/min/PAT/project — selfbase's own posture pick (Cloud's exact ceiling not public).
4. Audit trail = structured log only — selfbase's own posture pick (Cloud's audit posture not public).

Net spec shape change: lost FR-007 entropy on role names (deterministic now), restructured FR-008 from "scheduled reaper" to "project-teardown reclaim only", dropped User Story 4 (graceful Ctrl+C cleanup is no longer applicable — the role persists), added FR-013 (audit log). Spec is ~80 lines shorter than the pre-clarify draft and meaningfully closer to upstream parity.
