# Specification Quality Checklist: Hosted multi-project MCP + OAuth 2.1

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-26 (updated 2026-05-26 to add US4/US5/US6 — get_logs, list_storage_buckets, pause_project, restore_project)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs) — *Endpoints and protocol identifiers (OAuth 2.1, RFC 7591, JWT, MCP Streamable HTTP) are protocol/standards names, not library choices*
- [X] Focused on user value and business needs
- [X] Written for non-technical stakeholders — *OAuth + MCP are inherently technical domains, but the spec frames each story in operator-experience terms*
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous
- [X] Success criteria are measurable
- [X] Success criteria are technology-agnostic (no implementation details) — *SC items state operator-observable outcomes (e.g., "complete setup in under 90 seconds", "tool call returns within 5 seconds") rather than internals*
- [X] All acceptance scenarios are defined
- [X] Edge cases are identified
- [X] Scope is clearly bounded — *Out-of-scope items enumerated in Assumptions*
- [X] Dependencies and assumptions identified

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria
- [X] User scenarios cover primary flows
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification — *Standards/RFCs are referenced where wire-compatibility constrains behavior, which is appropriate for a protocol-conformance feature*

## Notes

- The feature description was specific enough to skip clarifications. Wire-shape and protocol choices are dictated by external standards (MCP spec + OAuth 2.1 RFCs + upstream Supabase MCP server) — clarifying any of them would be inventing rather than specifying.
- Updated 2026-05-26: scope expanded to include `get_logs` (US4), `list_storage_buckets` (US5), and `pause_project` + `restore_project` (US6). Adds FR-025..036 + SC-011..013. Updates FR-016 (tool allow-list) and SC-006 (deferred-tool list). The new in-scope tools all have existing infrastructure (analytics + storage containers per project; lifecycle worker for pause/resume) — pure wrapper work, ~4 days additional effort.
- Clarified 2026-05-26 (via `/speckit-clarify`, 4 questions): TTL strategy matches Cloud (1h access + 30-day refresh), signing key via HKDF from master key (label `selfbase-oauth-jwt-v1`), revocation via Redis revocation list keyed on JWT `jti`, DCR-only client registration (no pre-registered allow-list), MCP service single-replica. See `## Clarifications` section in spec.md for full Q&A.
- Remaining out-of-scope deferrals: finer-grained OAuth scopes (later feature), OAuth admin UI for client management (revoke is sufficient for v1), `get_advisors` (feature 016), `create_project` + `get_cost` + `confirm_cost` (feature 017), `get_storage_config` + `update_storage_config` + storage write-path (feature 018), all `branching` tools (issue #41).
- Ready for `/speckit-plan`.
