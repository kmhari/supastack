# Feature Specification: Test Coverage Uplift

**Feature Branch**: `015-test-coverage-uplift`

**Created**: 2026-05-26

**Status**: Draft

**Input**: User description: "want to increase test coverage as mentioned in issue 45"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Maintainer trusts security-critical code paths (Priority: P1)

A maintainer adds a new admin endpoint or modifies the RBAC matrix. They need confidence that authorization rules, schema validation, and secret handling behave exactly as intended — not just on the happy path but across role × action combinations and malformed inputs.

**Why this priority**: The shared package (RBAC matrix + zod schemas) gates every endpoint in the platform. A regression here silently weakens authorization for all projects on a VM. It currently has zero automated tests.

**Independent Test**: Run `pnpm --filter @supastack/shared test:coverage` and confirm the RBAC matrix and zod schemas are exercised by unit tests covering every defined action and every documented schema, with statement coverage ≥80%.

**Acceptance Scenarios**:

1. **Given** the RBAC matrix defines actions A1..An, **When** the test suite runs, **Then** every (role, action) cell is asserted to allow/deny as specified.
2. **Given** a zod schema with documented constraints, **When** valid and invalid payloads are fed in, **Then** the schema accepts valid payloads and rejects each invalid case with the expected error path.

---

### User Story 2 - Maintainer ships API/Management-API changes without breaking auth (Priority: P1)

A maintainer changes a `/v1/*` Management API handler, the auth middleware, or the error envelope. They need fast feedback that PAT validation, RBAC enforcement, request validation, and error shapes still hold for all touched routes.

**Why this priority**: `apps/api` is at 41% statement coverage. Auth and `/v1/*` handlers are the surface that external CLIs and MCP clients depend on; bugs here are user-visible and security-sensitive.

**Independent Test**: Run `pnpm --filter api test:coverage` and confirm auth middleware, RBAC enforcement, `/v1/*` Management API handlers, and the error envelope plugin reach ≥70% statement coverage with focused tests (not just route smoke).

**Acceptance Scenarios**:

1. **Given** a request with no PAT / expired PAT / wrong-scope PAT, **When** it hits a protected route, **Then** the auth middleware rejects it with the documented status + error envelope.
2. **Given** a PAT lacking a required RBAC action, **When** it calls the corresponding endpoint, **Then** the handler returns 403 with the documented envelope and never reaches the business logic.
3. **Given** a `/v1/*` Management API handler, **When** it receives a payload matching/violating the upstream contract, **Then** behavior matches the contract snapshot (status, shape, side effects).

---

### User Story 3 - Maintainer changes a worker job without breaking provisioning (Priority: P2)

A maintainer edits the provision pipeline, the pooler-reconciler classifier, the cert renewal job, or the backup job. They need to know whether state transitions, classification logic, and idempotency guarantees still hold without spinning up a live VM for every change.

**Why this priority**: `apps/worker` is at 25% statements. Worker jobs mutate per-instance state (containers, certs, backups); failures are operationally expensive and only surface on the live VM today.

**Independent Test**: Run `pnpm --filter worker test:coverage` and confirm provision, pooler-reconciler classification (all 7 drift classes), cert renewal, and backup jobs reach ≥60% statement coverage with unit tests on pure logic and integration tests where logic is non-trivial.

**Acceptance Scenarios**:

1. **Given** each of the 7 pooler drift classes is reproduced in fixtures, **When** the reconciler runs, **Then** it produces the documented classification and remediation action for each.
2. **Given** a partially-completed provision pipeline, **When** it is re-run, **Then** it converges to the same end state (idempotency).

---

### User Story 4 - Maintainer trusts the db package (Priority: P2)

A maintainer adds a migration or touches the port allocator. They need certainty that migrations remain idempotent and that port allocation never returns a colliding or out-of-range port under concurrency.

**Why this priority**: `packages/db` is at 24% statements. Idempotent migrations are a documented invariant of this repo; the port allocator is the source of truth for per-instance port assignment.

**Independent Test**: Run `pnpm --filter @supastack/db test:coverage` and confirm migration runner and port allocator reach ≥70% statement coverage including concurrent allocation and re-run scenarios.

**Acceptance Scenarios**:

1. **Given** the full migration set runs once and then again on the same database, **When** the second run completes, **Then** no schema changes are produced and no errors are raised.
2. **Given** the port allocator is asked for N ports concurrently, **When** allocation completes, **Then** every returned port is unique and within the configured range.

---

### User Story 5 - Maintainer ships UI changes without breaking critical flows (Priority: P3)

A maintainer changes the login page, project list, or secrets page in the SPA. They need a smoke-level signal that the critical flows still render and submit, even if exhaustive UI testing is out of scope.

**Why this priority**: `apps/web` is at 0%. Full SPA testing is explicitly out of scope, but a thin smoke layer catches the most embarrassing regressions (broken login, blank project list).

**Independent Test**: Run `pnpm --filter web test:coverage` and confirm login, project list, and secrets page reach ≥30% statement coverage via smoke tests that render the page and assert key interactions.

**Acceptance Scenarios**:

1. **Given** the login page is rendered with valid credentials in the form, **When** the user submits, **Then** the documented auth call is invoked.
2. **Given** the project list page is rendered with mocked data, **When** it mounts, **Then** the project rows render and clicking one navigates to the project route.

---

### Edge Cases

- A test inadvertently increases production-code `any` usage to make a path testable — must be blocked.
- A package's coverage briefly regresses below target after refactor — surfaced by `pnpm test:coverage` locally; CI gating is out of scope (see Out of Scope).
- Coverage tool reports differ between local and CI machines — targets are evaluated against the documented `pnpm test:coverage` runner only.
- A test depends on live external state (Docker, network) and is flaky — must be marked integration and isolated from the unit coverage targets.
- A test asserts implementation detail rather than behavior, locking in bugs — caught by code review, not automated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `packages/shared` MUST reach ≥80% statement coverage with unit tests covering the full RBAC matrix and all exported zod schemas (valid + invalid input cases).
- **FR-002**: `apps/api` MUST reach ≥70% statement coverage, concentrated in auth middleware, RBAC enforcement, `/v1/*` Management API handlers, and the error envelope plugin.
- **FR-003**: `apps/worker` MUST reach ≥60% statement coverage, with the provision pipeline, pooler-reconciler classification (all 7 drift classes), cert renewal, and backup jobs covered.
- **FR-004**: `packages/db` MUST reach ≥70% statement coverage, with migration-runner idempotency and port-allocator uniqueness/range/concurrency covered.
- **FR-005**: `apps/web` MUST reach ≥30% statement coverage via smoke tests for login, project list, and secrets pages.
- **FR-006**: The change set MUST NOT introduce new `any` usage in production code to enable testability; tests retain the existing `any` exemption per `eslint.config.js`.
- **FR-007**: New tests MUST prefer unit tests where practical; integration tests are used only where a unit test would be a tautology or where logic crosses a real boundary (DB, filesystem, container runtime).
- **FR-008**: Existing well-covered packages (`packages/oauth`, `packages/crypto`, `apps/mcp`) MUST NOT regress below their current coverage levels.
- **FR-009**: All new tests MUST run under the existing `pnpm test:coverage` command without new tooling dependencies beyond what each package already declares.
- **FR-010**: Tests that exercise security-sensitive behavior (PAT generation/validation, password handling, RBAC decisions, secret encryption) MUST assert observable behavior, not mock the unit under test.

### Key Entities

- **Coverage Report**: Per-package statement / branch / function / line percentages produced by `pnpm test:coverage`; the contract surface this feature is measured against.
- **RBAC Matrix**: Truth table of `(role, action) → allow|deny` in `packages/shared/src/rbac.ts`; full coverage means every cell is asserted.
- **Zod Schema Set**: Exported request/response schemas in `packages/shared`; full coverage means every schema has at least one accept-case and one reject-case test per documented constraint.
- **Management API Contract Snapshot**: The pinned upstream OpenAPI snapshot used to validate `/v1/*` handler shape parity; tests reference it rather than ad-hoc fixtures.
- **Pooler Drift Class**: One of 7 documented classifications produced by the reconciler; full coverage means each class has a fixture and an assertion of the chosen remediation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After this work, `pnpm test:coverage` reports `packages/shared` ≥80%, `apps/api` ≥70%, `apps/worker` ≥60%, `packages/db` ≥70%, and `apps/web` ≥30% statements.
- **SC-002**: After this work, `pnpm test:coverage` reports `packages/oauth`, `packages/crypto`, and `apps/mcp` at or above their 2026-05-26 baselines (98%, 99%, 65% statements respectively).
- **SC-003**: Every action defined in the RBAC matrix is asserted in tests; no action is unreferenced.
- **SC-004**: Every documented pooler drift class (7 total) has a reproducing fixture and a remediation assertion.
- **SC-005**: Re-running the full migration sequence twice on a fresh database produces zero schema diffs in the second run, asserted by an automated test.
- **SC-006**: The change set introduces zero new `any` usages in production source files (verified by lint diff).
- **SC-007**: Time to detect a regression in any covered area drops from "manual VM test" to a single `pnpm test` run completing in under 2 minutes per affected package.

## Assumptions

- The `pnpm test:coverage` runner introduced in commit b54deec is the canonical measurement tool; targets are evaluated against its output.
- The 2026-05-26 baselines quoted in issue #45 remain the reference for "current" coverage.
- CI coverage gating / threshold enforcement is explicitly out of scope (issue #45 calls it out separately).
- E2E shell scripts under `tests/cli-e2e/*.sh` are not counted toward coverage targets and are not modified by this work.
- The existing `any`-in-tests exemption in `eslint.config.js` remains; this feature does not change lint config.
- Test infrastructure may be added under each package's existing `tests/` or `__tests__/` location plus a shared `tests/helpers/` if a helper is reused across packages.
- Coverage targets may be approached in any order; user stories are independently testable and shippable.

## Out of Scope

- Adding CI coverage gating or PR-blocking threshold checks.
- Restructuring source code primarily to make it testable (refactors allowed only when they don't add `any` and don't change observable behavior).
- E2E coverage measurement of the `tests/cli-e2e/*.sh` scripts.
- Full SPA test coverage for `apps/web` beyond the three named flows.
- Raising coverage for packages already above their target (`oauth`, `crypto`, `mcp`).
