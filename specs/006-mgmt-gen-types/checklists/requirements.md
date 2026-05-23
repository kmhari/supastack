# Specification Quality Checklist: CLI — `gen types typescript` + `migration *`

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-23
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs) — endpoint behavior described as user-visible CLI outcomes; pg-meta mentioned only as a non-binding assumption
- [X] Focused on user value and business needs — both stories lead with the developer's day-1 (types) and day-2 (migrations) workflow
- [X] Written for non-technical stakeholders — CLI command sequences shown, internal mechanics abstracted
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous — every FR specifies a measurable behavior, shape contract, or status code mapping
- [X] Success criteria are measurable — time bounds (5s / 10s / 30s), zero regressions, concrete row-count assertions for concurrency
- [X] Success criteria are technology-agnostic — phrased as user-observable outcomes
- [X] All acceptance scenarios are defined — US1 has 5 scenarios, US2 has 8 scenarios covering happy path + idempotency + drift recovery + concurrency + auth/RBAC
- [X] Edge cases are identified — 8 gen-types edges + 8 migrations edges covering boundary conditions, scale, malformed input, lazy bootstrap
- [X] Scope is clearly bounded — 2 user stories, 2 + 3 = 5 endpoints; explicit out-of-scope statement excludes arbitrary-SQL query endpoint
- [X] Dependencies and assumptions identified — 9 assumptions covering CLI version target, pg-meta reuse, network reuse from feature 005, schema lazy bootstrap, auth/RBAC reuse, db push reuse, type mapping rules, arbitrary-SQL explicitly punted

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria — each FR maps to one or more scenarios or edge cases
- [X] User scenarios cover primary flows — US1 is the build-time path, US2 is the schema-evolution day-2 path
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification

## Notes

- US2 leans heavily on feature 005's pooler/direct DB endpoints; new API surface is intentionally minimal (3 migration endpoints) — the heavy lifting of "apply SQL to remote Postgres" is already solved.
- Arbitrary-SQL `POST /v1/projects/<ref>/database/query` deliberately deferred — would need its own design pass (authz on what SQL is safe to expose, rate-limits, audit verbosity)
- Sibling endpoint groups still split out as low-priority: custom domains (#10), postgres/auth config (#11), ssl-enforcement (#12)
