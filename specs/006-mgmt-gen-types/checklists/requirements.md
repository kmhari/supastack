# Specification Quality Checklist: CLI — gen types + migration + snippets + backups list/restore

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-23
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs) — endpoint behavior described as user-visible CLI outcomes; pg-meta / user_content mentioned only as non-binding assumptions
- [X] Focused on user value and business needs — each story leads with the developer/operator outcome
- [X] Written for non-technical stakeholders — CLI command sequences shown, internal mechanics abstracted
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous — every FR specifies a measurable behavior, shape contract, or status code mapping
- [X] Success criteria are measurable — time bounds (2s/5s/10s/30s/5min), zero regressions, concrete state-comparison assertions
- [X] Success criteria are technology-agnostic — phrased as user-observable outcomes
- [X] All acceptance scenarios are defined — US1×5, US2×8, US3×6, US4×8 = 27 scenarios total
- [X] Edge cases are identified — 8 gen-types + 8 migrations + 5 snippets + 7 backups = 28 edge cases
- [X] Scope is clearly bounded — 4 user stories, 11 new endpoints, explicit out-of-scope statement for arbitrary-SQL query + sibling Tier 1 groups
- [X] Dependencies and assumptions identified — 11 assumptions covering CLI shape contract, pg-meta reuse, network reuse, snippet storage location, restore-as-snapshot model, RBAC, type mapping

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria — each FR maps to one or more scenarios or edge cases
- [X] User scenarios cover primary flows — gen types (build-time), migrations (day-2 schema evolution), snippets (SQL portability), backups (disaster recovery)
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification

## Notes

- **Restore is the heaviest new work** in this spec: NEW restore_job entity, NEW worker job (stop → swap → restart → verify), NEW project status (`restoring`), NEW RBAC gate. Other endpoints are mostly read-only wrappers over existing per-instance state.
- **Snippets are read-only via the API**: write operations remain Studio-only. The CLI doesn't expose snippet create/update/delete today; if upstream adds them, follow-up spec.
- **Restore semantics differ from Cloud**: Cloud uses PITR via continuous WAL streaming; supastack uses snapshot-id-based restore. Endpoint name kept the same (`/restore-pitr`) for CLI compatibility; the payload differs (we accept `backup_id`, Cloud accepts `recovery_time_target`).
- **Sibling endpoint groups** still split as low-priority issues: custom domains (#10), postgres/auth config (#11), ssl-enforcement (#12).
- **Arbitrary-SQL query endpoint** deliberately deferred — security-sensitive, warrants its own spec pass.
