# Specification Quality Checklist: Platform Studio base=root API URL + legacy studio reduced to /setup

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-04
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Open clarification RESOLVED by operator direction (2026-06-04): keep `/api/v1` as the retained internal engine (it is load-bearing — the platform studio delegates to it; backups/audit have only-real impls there); reduce the legacy SPA to setup-only; make setup reuse the platform org primitive + GoTrue. Only the two redundant façade copies may be removed.
- Scope premise corrected after the 4-investigator audit: `/api/v1` is the engine, not a dead namespace. `/platform/*` is ~46 real (many delegate back to `/api/v1` or `/v1`) + ~112 stubs.
- Spec intentionally references URL path prefixes (`/v1/*`, `/platform/*`, `/api/v1/*`, `/setup*`) because those paths ARE the behavioral contract of this feature.
- **Amendment (2026-06-04)**: added US5 (setup-completion gate at `/` → `/setup` until install done) and US6 (migrate the real database-backup engine into the platform studio's `/platform/database/:ref/backups` + `/restore-physical` + `/platform/projects/:ref/status`, Cloud-shaped). This **promotes backup-realness from deferred follow-up to in-scope**; US1–US3 are already implemented, so US5/US6 need new plan + tasks (re-run `/speckit-plan` + `/speckit-tasks`).
- Follow-ups still deferred: make the platform **audit** routes real; de-duplicate the redundant `/api/v1` façade copies (needs test migration).
