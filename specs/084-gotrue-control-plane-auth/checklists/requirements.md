# Specification Quality Checklist: GoTrue Control-Plane Auth + Multi-Tenant Orgs + Cloud RBAC

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-02 · **Updated**: 2026-06-02 (full surface + Studio shapes; then: numeric role ids + 20-char org ref)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — see note
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

- Validation pass (2026-06-02, post-update): all items pass.
- **Deliberate borderline**: the spec now includes a **Platform API Surface** section listing the
  exact `/platform/*` paths the dashboard calls. This reads as implementation detail, but it is the
  literal user-facing contract for this feature (whose entire purpose is to make the unmodified Studio
  dashboard work). It is framed as "the paths the dashboard requires," with field-level shapes pushed
  to `contracts/`, not the spec body. Kept by explicit user request ("fold in the full set").
- **Captured-from-code**: the surface + role model were re-captured from the Studio fork source
  (`apps/studio/data/**`), correcting the role model from a string enum to **role objects with
  numeric ids** (FR-017, Assumptions, `contracts/organization-members.md`, `data-model.md`).
- The functional/locked technical decisions (GoTrue, HKDF secret, split singleton) remain in
  `plan.md`; `spec.md` stays WHAT/WHY at the requirement level.
- **Identifier corrections (this pass)**: (1) organization roles are **numeric-id role objects**
  (1 Owner…4 Read-only), not a string enum — FR-017, entities, `data-model.md` mapping table,
  `contracts/organization-members.md`. (2) An organization's `id` is a **20-char ref string** (project-
  ref style via `generateRef`), used as both `id` and the URL/path `slug` — never a UUID — FR-014,
  entities, Assumptions, SC-010, `data-model.md`, `contracts/organizations.md`. GoTrue user ids stay
  UUIDs; only the org identifier changed.
