# Feature Specification: A CI-Enforced Home for Integration & Infra-Contract Tests

**Feature Branch**: `023-integration-test-home`

**Created**: 2026-05-29

**Status**: Draft

**Input**: User description: "find a place for this test" — the web cache-headers regression test (#80 / PR #90) and integration / infra-contract tests generally.

## Clarifications

### Session 2026-05-29

- Q: Where should the new home for integration / infra-contract tests live so CI collects them? → A: A node-environment vitest project rooted at the repo-level `tests/` directory, added to the workspace globs — existing `tests/integration/*` and new cross-cutting/contract tests are collected with no moves.
- Q: How should the 3 env-gated orphaned integration tests (backup, backup-retention, provision-instance) be handled? → A: Collect them so they report as skipped when live-stack env is absent (visible, not dormant); actually executing them in CI is tracked in #91 (blocked on the env solution in #75) — out of scope here.
- Q: Should behavioral container-based checks (the cache-header docker+curl `.sh`) run in CI or stay manual-only? → A: Manual-only — documented as a local/VM check; CI protection comes from the equivalent collected vitest contract test. No Docker-backed CI job is added.
- Q: Should the cache-header contract test (currently `apps/web/tests/unit`, with a node-env override) relocate to the new root `tests/` home? → A: No — leave it in `apps/web/tests/unit` (already a collected location; web-adjacent; already shipped in PR #90). The root `tests/` home serves the orphaned `tests/integration/*` and future cross-cutting tests; this test stays put with its env override.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An integration/contract test I write actually runs in CI (Priority: P1)

As a contributor, when I add a test that is **not** a unit test for a single package — e.g. a test spanning several packages, or a cross-cutting integration / infra-contract test that belongs to no single package — I place it in one obvious location and it runs on every CI build with no extra wiring.

**Why this priority**: This is the core gap. Today such a test either lands in a directory the test runner never scans (so it never executes) or is shoehorned into a package's unit suite with an environment workaround. Either way the protection is unreliable. Without this story the feature delivers nothing.

**Independent Test**: Add a trivial passing integration/contract test in the designated location, push, and confirm it is executed (counted and named) in the CI test run. Make it fail and confirm CI goes red.

**Acceptance Scenarios**:

1. **Given** a new test placed in the designated integration-test location, **When** CI runs the test job, **Then** the test is collected and executed (it appears in the run summary).
2. **Given** a contract test that must read a repository file and run outside a browser environment, **When** it runs, **Then** it executes successfully without any per-file environment-override workaround.
3. **Given** that test asserts a false condition, **When** CI runs, **Then** the build fails with the failure attributed to that test.

---

### User Story 2 - No test in the repository is silently dormant (Priority: P2)

As a maintainer, I want every committed test file to be executed by some CI job — or, if it genuinely cannot be, to carry an explicit and visible "manual-only" marker — so that a test file can never give false confidence by existing but never running.

**Why this priority**: The repo currently has integration tests that no one noticed were never executed, and a contract test that had to be shoehorned elsewhere. Eliminating the existing dormancy is high value, but it depends on Story 1's home existing first.

**Independent Test**: Enumerate every test file in the repo and confirm each is either executed by a CI job or carries a documented manual-only marker. Zero unaccounted-for test files.

**Acceptance Scenarios**:

1. **Given** the existing dormant integration tests and the cache-header tests, **When** the feature is complete, **Then** each is relocated into a collected location or explicitly retired / marked manual-only with a recorded reason.
2. **Given** a test that requires an external live environment and cannot run in CI, **When** it is collected, **Then** it reports as **skipped** (visible) rather than being absent from the run.

---

### User Story 3 - Future dormant tests are prevented automatically (Priority: P3)

As a maintainer, I want CI to fail when a newly-added test file would not be executed by any job, so the dormancy problem cannot silently return.

**Why this priority**: Prevents regression of the exact problem this feature fixes, mirroring the self-maintaining coverage floor established for the dashboard page registry. Valuable, but a guard is only meaningful once Stories 1 and 2 establish the correct homes.

**Independent Test**: Add a test file in a location no CI job collects and confirm a guard fails with an actionable message naming the file and the expected location; with everything in place it passes.

**Acceptance Scenarios**:

1. **Given** a test file added outside any collected location, **When** the guard runs, **Then** it fails and names the offending file and the correct destination.
2. **Given** all test files are in collected locations, **When** the guard runs, **Then** it passes.

---

### Edge Cases

- A check that requires a real container runtime (the behavioral header check) — is it executed in CI, or explicitly designated manual-only? (See Assumptions.)
- A test that needs a non-browser runtime (file reads, crypto) must be supported by the chosen home without per-file environment hacks.
- An environment-gated test (skipped when live-stack secrets are absent): "collected but skipped" must be distinguishable from "not collected at all."
- A test that imports from multiple workspace packages must resolve those imports in the chosen home.
- Two tests sharing a name across categories must not collide in the run report.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST provide a single, documented location for integration / infra-contract tests that do not belong to a single package's unit suite.
- **FR-002**: Tests placed in that location MUST be collected and executed by the CI test job with no per-test configuration.
- **FR-003**: That location MUST run tests in an environment suitable for non-UI logic (reading repository files, using platform APIs) without requiring a per-file environment-override workaround.
- **FR-004**: The currently-dormant root integration tests MUST become collected (via the root `tests/` project), and both cache-header tests MUST have a recorded disposition — the contract test stays in its already-collected location (`apps/web/tests/unit`); the behavioral `.sh` is documented manual-only. None left silently uncollected.
- **FR-005**: The system MUST distinguish "collected but skipped" from "not collected." Environment-gated tests MUST remain collected so they surface as skipped rather than absent.
- **FR-006**: CI MUST fail when a committed test file resides in a location that no CI job collects, reporting the offending file and the expected location.
- **FR-007**: The CI test run MUST surface which test suites executed, so coverage is auditable from the build log.
- **FR-008**: Checks that require a container runtime MUST be either executed by a CI job or explicitly designated manual-only in a documented, discoverable way — there must be no ambiguous "is this actually run?" state.
- **FR-009**: The convention for which kind of test goes where MUST be documented in a location contributors can discover.

### Key Entities *(include if feature involves data)*

- **Test category**: unit (per-package) / integration (cross-package or live-stack) / infra-contract (asserts a property of a built artifact or config) / behavioral-e2e (container or browser). Each maps to a home and an execution mode.
- **Test-collection configuration**: the configuration that determines which test files the runner discovers and executes.
- **CI test job(s)**: the build steps that execute collected tests and report results.
- **Dormancy guard**: the check that fails the build when a test file sits in a location no job collects.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of automated test files in the repository are executed by a CI job (zero dormant test files), verifiable by comparing the set of test files to the runner's executed set.
- **SC-002**: A contributor can add an integration/contract test in the designated location and see it run in CI with zero additional configuration (no new config file, no environment-override comment).
- **SC-003**: Every previously-dormant test suite and both cache-header tests is, post-feature, either executing in CI or carrying a documented manual-only / retired marker — 0 silently skipped.
- **SC-004**: Adding a test file in a non-collected location causes CI to fail with a message that names the file and the correct location (verified by a deliberate negative case).
- **SC-005**: A contributor can determine where a new test of a given kind belongs in under 1 minute from a single documented reference.

## Assumptions

- The existing test runner and CI job structure (guardrails / unit / browser-e2e) are reused; no new test framework is introduced. (Concretely: the vitest workspace and the `.github/workflows/ci.yml` jobs.)
- "Integration / infra-contract test" means a test above the per-package unit level — either spanning multiple packages or asserting a property of a built artifact or config (e.g. the production `apps/web/Caddyfile.runtime`).
- The dormancy is caused by the current vitest workspace collecting only `packages/*` and `apps/*`, leaving root `tests/integration/*` uncollected. **Resolved (Clarifications):** the home is a node-environment vitest project rooted at the repo-level `tests/` directory, added to the workspace globs, so `tests/integration/*` and new cross-cutting/contract tests are collected as-is.
- The live-stack-gated integration tests (`tests/integration/backup*.test.ts`, `provision-instance.test.ts`, which require `TEST_API_URL` / `TEST_TOKEN_ADMIN` / `TEST_INSTANCE_REF`) are made **collected** so they report as skipped when those vars are absent. Actually executing them in CI is **out of scope** here and tracked in **#91** (blocked on the control-plane env solution in **#75**).
- Behavioral container-based checks (the `.sh` scripts under `tests/cli-e2e/`) remain manual/local-or-VM and are **documented as manual-only** (**Resolved (Clarifications):** no Docker-backed CI job); their CI safety net is the equivalent collected vitest contract test (the pattern used for the cache-header fix).
- The dormancy guard follows the existing self-maintaining-coverage precedent (a script wired into `pnpm lint`), not a new CI platform.
- The cache-header fix itself (#80 / PR #90) is already shipped and independent. Its vitest contract test stays in `apps/web/tests/unit` (a collected location); this feature does **not** relocate it. The root `tests/` home targets the orphaned `tests/integration/*` and future cross-cutting tests.
