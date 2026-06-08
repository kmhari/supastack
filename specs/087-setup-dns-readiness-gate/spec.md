# Feature Specification: Setup wizard DNS-readiness gate — trust the authoritative backend signal (fix #94)

**Feature Branch**: `087-setup-dns-readiness-gate`

**Created**: 2026-06-04

**Status**: Draft

**Input**: GitHub issue #94 (Option A): "In the setup wizard, the backend's authoritative `allDnsReady` signal is captured (`allTxtReady`) but never read — the DNS-readiness gate uses a brittle client-side recount (`allTxtFound`) instead. Wire the gate to the backend signal; remove the dead variable + the temporary eslint-disable."

## Context & Glossary

During first-time install, the setup wizard's step 2 ("verify your domain") asks the operator to add DNS records (an apex A-record, a wildcard A-record, and `_acme-challenge` TXT records) so a wildcard TLS certificate can be issued via DNS-01. The wizard polls the supastack server and only enables the **"Create Certs"** button once DNS is ready.

There are two signals for "are the TXT records published yet?":

- **Backend `allDnsReady` (authoritative)** — the server resolves the TXT records via **public DNS resolvers** (Cloudflare/Google/Quad9), which approximates the global, propagated view that the certificate authority's validators will see. It returns a single ready/not-ready boolean. The wizard already captures this into a variable (`allTxtReady`) but never uses it.
- **Client-side `allTxtFound` (brittle recount)** — the browser re-derives readiness by looping over its *own* (frozen, captured-once) list of expected records and cross-referencing the server's per-record results by value. This is what the gate actually uses today.

The client recount has two latent problems: (1) its record list is captured once and can go **stale** if the underlying challenge is re-issued/refreshed mid-session, leaving the gate stuck on "Waiting for DNS…" even after DNS is ready; (2) it duplicates a decision the server already makes authoritatively. The unused authoritative variable also trips the linter (unused-variable), currently silenced with a temporary `eslint-disable` + TODO pointing at this issue.

This feature switches the gate to the authoritative backend signal and removes the dead code + the lint suppression. It does **not** change how DNS is resolved (still public resolvers) and does **not** add any browser-side DNS lookup.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The wizard unlocks cert creation exactly when DNS is actually ready (Priority: P1)

When the operator has added the required DNS records and they are visible to public resolvers, the wizard's "Create Certs" button becomes enabled promptly — driven by the server's authoritative readiness signal. When the records are not yet published, the button stays disabled. The operator is never left falsely stuck waiting after DNS is genuinely ready, and the button never unlocks before the records actually exist.

**Why this priority**: This is the user-facing correctness fix. A wizard that stays stuck on "Waiting for DNS…" after DNS is ready blocks the entire install; a wizard that unlocks prematurely lets a doomed cert request proceed.

**Independent Test**: On a test domain, leave the TXT records unset → confirm the button stays disabled. Add the records, wait for public-resolver propagation → confirm the button enables within one poll cycle without any manual workaround. (And the regression case: trigger a challenge refresh mid-session → confirm the gate still reflects the current state rather than getting stuck.)

**Acceptance Scenarios**:

1. **Given** the operator is on step 2 with the TXT records not yet published, **When** the wizard polls, **Then** the "Create Certs" button remains disabled ("Waiting for DNS…").
2. **Given** the TXT records are published and visible to public resolvers, **When** the wizard polls, **Then** the button enables within one poll cycle.
3. **Given** the challenge is re-issued/refreshed during the session (new records), **When** the operator publishes the new records, **Then** the gate reflects the current challenge and enables — it does not get permanently stuck on a stale list.
4. **Given** there are no challenge records present yet, **When** the wizard evaluates readiness, **Then** the button is NOT enabled (no vacuous "ready" state).

---

### User Story 2 - Remove the dead recount + clear the lint suppression (Priority: P2)

The now-unused client-side recount and the temporary `eslint-disable`/TODO (added to keep `main` green without masking the decision) are removed, so the area has no unused variables and no disabled lint rule.

**Why this priority**: Code-health debt that this fix is the trigger to clear. The whole reason the issue surfaced was the unused-variable lint error; resolving the gate decision lets the suppression be deleted rather than left indefinitely.

**Independent Test**: Run the linter over the setup wizard → zero unused-variable errors and no `eslint-disable` directive remaining for this gate; the referenced TODO/issue marker is gone.

**Acceptance Scenarios**:

1. **Given** the gate now uses the backend signal, **When** the linter runs, **Then** there are no unused-variable errors in the setup wizard and no `eslint-disable` covering this code.
2. **Given** the change is complete, **When** searching the wizard source, **Then** the brittle client-side recount and its supporting state/TODO are gone.

---

### Edge Cases

- **No challenge records yet**: the backend's readiness computation treats an *empty* record list as trivially "all found" (an every-of-empty is true). The gate MUST NOT open in this state — readiness requires that challenge records actually exist AND are found.
- **Challenge re-issued/refreshed mid-session**: the gate must track the current challenge, not a stale captured-once list (the core staleness bug behind #94).
- **Backend status call fails / transient error**: the gate must stay closed (fail-safe) and the wizard must not crash or get stuck in a broken state.
- **DNS negative-cache staleness**: after records are published, a resolver may briefly still report "not found" for its negative-TTL window; the gate may show "waiting" a little longer and then self-heal. This is acceptable; the fix MUST NOT add a browser-side DNS/apex lookup to work around it (that would risk caching a negative result on the operator's own resolver).
- **Apex / wildcard A-records not yet resolving**: unchanged — these continue to gate cert creation alongside TXT readiness.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The DNS-readiness gate that enables "Create Certs" MUST be driven by the backend's authoritative DNS-ready signal (the one derived from querying public DNS resolvers), not by a client-side re-aggregation of per-record results.
- **FR-002**: The gate MUST NOT enable cert creation when no challenge records are present — readiness requires that challenge records exist and are reported as found (no vacuous-empty "ready").
- **FR-003**: The gate MUST reflect the current challenge state if the challenge is re-issued or refreshed during the wizard session, with no dependence on a single captured-once record list that can go stale.
- **FR-004**: The wizard MUST continue to require the apex and wildcard A-records to resolve (server-side) before enabling cert creation — existing behavior, unchanged.
- **FR-005**: The now-unused client-side readiness recount and its supporting state MUST be removed, and the temporary `eslint-disable` + TODO referencing this issue MUST be deleted, leaving no unused variables and no suppressed lint rule in the wizard.
- **FR-006**: If the backend readiness signal is unavailable or errors, the gate MUST remain disabled (fail-safe) and the wizard MUST not crash.
- **FR-007**: The post-issuance reachability behavior (the server-side HTTPS probe of the apex) MUST be unchanged; no browser-side DNS or apex fetch is introduced.

### Key Entities

- **DNS-readiness signal (authoritative)**: a single ready/not-ready boolean produced by the server from public-resolver lookups of the `_acme-challenge` TXT records; the basis for the gate.
- **Challenge records**: the set of `_acme-challenge` TXT records the operator must publish for the current DNS-01 order.
- **The gate**: the condition that enables the "Create Certs" action — apex A resolves AND wildcard A resolves AND the authoritative TXT-readiness signal is true (with records present).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When the required DNS records are published and visible to public resolvers, the wizard enables "Create Certs" within one poll cycle, with **0** manual workarounds.
- **SC-002**: When no challenge records exist (or none are found), the wizard enables "Create Certs" in **0%** of cases (never vacuously ready).
- **SC-003**: In the challenge-refresh scenario, the wizard no longer becomes permanently stuck on "Waiting for DNS…" — it reaches the enabled state once the current records are published.
- **SC-004**: The setup wizard has **0** unused-variable lint errors for this area and **0** `eslint-disable` directives covering the gate; the #94 TODO marker is removed.
- **SC-005**: Apex/wildcard A-record gating and post-issuance HTTPS reachability behave identically to before (no regression).

## Assumptions

- The backend already computes an authoritative DNS-readiness signal from public resolvers; this feature consumes it rather than introducing a new resolution mechanism.
- Issue #94's "Option A" (use the backend signal) is the chosen resolution, not "Option B" (delete the captured signal as leftover).
- Upgrading the server's DNS pre-check from recursive public resolvers to **authoritative nameservers** (an even-more-robust source that avoids negative-cache staleness) is **out of scope** here and recorded as a potential follow-up.
- The backend's readiness computation may need a small guard so an empty record list is not reported as "ready" (FR-002); whether that guard lives in the backend signal or in how the gate consumes it is a planning detail.
- This builds on feature 086, which keeps the setup wizard as the sole surviving page of the legacy SPA; no conflict is expected.
