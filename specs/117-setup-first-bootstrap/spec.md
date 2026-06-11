# Feature Specification: Single-Source Apex — domain set once at install, `/setup` guides DNS (no re-entry)

**Feature Branch**: `117-setup-first-bootstrap`

**Created**: 2026-06-10 · **Retargeted**: 2026-06-11

**Status**: Draft

**Input**: User direction (retarget): "don't ask for the domain again in `/setup` — the apex is already established at install; take the operator straight to the DNS-records (TXT + A) step. Make the install-time domain the single source of truth, mirror it so nothing diverges, make the installer prompt reliable (including `curl | bash`), and remove the dead domain-resolution fallback." (Supersedes the earlier Option-2 / setup-first-bootstrap framing of this feature.)

## Overview

The platform's domain is established **once, at install time**, and is the **single source of truth** for everything (routing, identity, dashboard, APIs, certificates). Today there is a second place the domain can be entered — the `/setup` wizard's domain field — which writes a separate stored value that most of the platform ignores. That duplicate is misleading and can silently diverge from the real (install-time) value (issue #110).

This feature removes the duplication. The installer reliably captures the domain (even when run via `curl | bash`) and persists it as the one authoritative value. The running platform reads that one value **directly** everywhere, and the previously-separate stored copy (the database column) is removed — so there is no second value that can disagree. `/setup` **no longer asks for the domain** — it reads the established domain and takes the operator straight to the DNS records they must create (apex address record, wildcard address record, and the certificate-challenge TXT record), verifies them, issues the certificate, and proceeds to admin-account creation exactly as before. The unused two-source domain-resolution fallback is deleted.

The boot model is **unchanged** — the platform still comes up with the domain already known (as it does today). This feature only removes the duplicate entry point and unifies the source; it does **not** introduce apex-less boot, staged activation, or browser-chosen domains (those were the heavier Option-2 approach, deliberately not taken here).

## Clarifications

### Session 2026-06-11

- Q: When the platform is on the local/default fallback domain (e.g. `localhost`), what should `/setup` do at the DNS + certificate step? → A: **Block** — `/setup` requires a real domain established at install. It refuses to proceed (directing the operator to re-run the installer with a real domain) rather than attempt a meaningless DNS-01 / wildcard certificate for a local domain.
- Q: How should the single source of truth be enforced across the ~20 components that read the domain from the database today? → A: **Repoint all readers to the authoritative install-time value and remove the database domain column entirely** — no second store exists, so divergence is impossible by construction (chosen over keeping the DB value as a mirror).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - `/setup` guides DNS instead of re-asking the domain (Priority: P1)

An operator who has installed the platform (domain already established) opens the setup wizard. Instead of being asked to type the domain again, they immediately see **their** domain plus the exact DNS records to add — the apex address record, the wildcard address record, and the certificate-challenge TXT record. They add the records, the platform verifies them and issues the certificate, then continues to admin-account creation. At no point can they enter a second, conflicting domain.

**Why this priority**: This is the #110 fix and the core value — it removes the misleading duplicate domain entry and makes the established domain the only one. It directly closes the split-brain.

**Independent Test**: With a domain established at install, open `/setup`; confirm **no domain-entry field is shown**; confirm the DNS records displayed are for the established domain; complete DNS verification and certificate issuance; confirm there is no UI or request that can set a different domain.

**Acceptance Scenarios**:

1. **Given** the domain is established at install, **When** the operator opens `/setup`, **Then** the wizard shows the established domain and the required DNS records — and shows **no** domain-entry field.
2. **Given** the operator has added the shown DNS records, **When** they ask the platform to verify, **Then** the platform confirms the records and issues the certificate for the domain and its subdomains.
3. **Given** the operator is in `/setup`, **When** they look for a way to change the domain, **Then** there is none — the established domain is read-only in this flow.
4. **Given** the certificate has been issued, **When** the operator continues, **Then** admin-account creation proceeds unchanged.

---

### User Story 2 - Reliable install-time domain capture (Priority: P2)

A person installs the platform on a new server. However they launch the installer — running the script as a file, piping it from `curl`, passing the domain as an argument, or via an environment value — the installer captures the domain and persists it to the platform's configuration. It only falls back to a local/default domain when no domain was supplied **and** there is genuinely no way to ask, and it warns clearly when it does.

**Why this priority**: Today the prompt is skipped when the installer is piped (`curl | bash`), so the most common install silently defaults to `localhost`. Making capture reliable is what makes "anyone on a new server" actually work, and it is the entry point that feeds User Story 1's single source.

**Independent Test**: Run the installer four ways — as a local file (answer the prompt), piped from `curl` (still prompts), with the domain as an argument, and with the domain as an environment value — and confirm each persists the same domain to the platform configuration; run it piped with no domain and no terminal and confirm it defaults to local **with a visible warning**, not silently.

**Acceptance Scenarios**:

1. **Given** the installer is run as a local file with no domain pre-supplied, **When** it reaches domain capture, **Then** it prompts and persists the entered domain.
2. **Given** the installer is run via a piped command (e.g. `curl | bash`), **When** it reaches domain capture and a terminal is available, **Then** it still prompts (it does not silently skip to a default).
3. **Given** the domain is supplied as an argument or environment value, **When** the installer runs, **Then** it uses that value without prompting.
4. **Given** no domain is supplied and no interactive terminal exists, **When** the installer runs, **Then** it falls back to the local/default domain and emits a clear warning that a real domain must be set for a public deployment.

---

### User Story 3 - One value everywhere, no second store, dead path removed (Priority: P3)

The platform exposes exactly one domain value. Every component that needs the domain reads the single authoritative install-time value **directly**; the previously-separate stored domain value (the database column) and the unreachable two-source resolution fallback are **both removed**, so there is no second store and nothing that can diverge.

**Why this priority**: This is the invariant + cleanup that guarantees #110 cannot recur and removes dead, confusing code + the redundant store. It is lower priority because Stories 1 and 2 already eliminate the *entry* of a divergent value; this hardens and tidies.

**Independent Test**: Inspect every place the platform reads the domain and confirm they resolve the same single authoritative value; confirm the separate stored domain value (database column) has been removed and nothing reads or writes it; confirm the old two-source fallback no longer exists.

**Acceptance Scenarios**:

1. **Given** a freshly started platform, **When** any component reads the domain (routing, identity, dashboard, APIs, certificates), **Then** they all resolve the same single authoritative value.
2. **Given** the platform after this change, **When** the codebase is searched for the separate stored domain value (the database column), **Then** it no longer exists and nothing reads or writes it.
3. **Given** the codebase after this change, **When** the unused two-source domain-resolution fallback is searched for, **Then** it is gone and no behavior depends on it.

---

### Edge Cases

- **Platform installed on the local/default domain** (e.g. `localhost`): `/setup` MUST block the DNS + certificate step and instruct the operator to set a real domain at install (re-run the installer); it MUST NOT attempt certificate issuance for a local domain and MUST NOT offer a domain-entry field.
- **Operator re-opens `/setup` after the certificate already exists**: the wizard reflects the issued state and continues to admin creation; it does not re-prompt for the domain.
- **Installer re-run with the domain already persisted**: the existing value is kept; the operator is not asked again and no divergent value is written.
- **Operator wants a different domain later**: this is a deliberate re-install operation; it is **not** offered through `/setup` or the dashboard (out of scope here).
- **Piped install with no terminal and no domain supplied**: falls back to the local/default domain **with a warning** (never a silent default).

## Requirements *(mandatory)*

### Functional Requirements

**Single source of truth**

- **FR-001**: The platform MUST treat the install-time domain as the single authoritative source; routing, identity, dashboard, APIs, and certificates MUST all resolve that one value.
- **FR-002**: The platform MUST make the authoritative domain available to the setup experience **without** the operator re-entering it.
- **FR-003**: The platform MUST NOT provide any path — in the setup wizard, the dashboard, or an API — to set a second domain value that can diverge from the authoritative one.
- **FR-004**: All components that need the domain MUST read it from the single authoritative install-time source; the platform MUST remove the separate stored domain value (the database column) and repoint every reader to the authoritative value, so that no second store of the domain exists.

**`/setup` guides DNS (does not ask for the domain)**

- **FR-005**: When the domain is established, the setup experience MUST NOT present a domain-entry field; it MUST proceed directly to showing the required DNS records.
- **FR-006**: The setup experience MUST display the exact DNS records the operator must create for the established domain — the apex address record, the wildcard address record, and the certificate-challenge (TXT) record.
- **FR-007**: The setup experience MUST verify the operator's DNS records, issue the certificate for the domain and its subdomains, then continue to admin-account creation unchanged.
- **FR-008**: If the established domain is the local/default fallback (not a real public domain), the setup experience MUST block the DNS + certificate step and direct the operator to set a real domain at install (re-run the installer); it MUST NOT attempt DNS-01 / certificate issuance for a local domain and MUST NOT offer a domain-entry field.

**Reliable install-time capture**

- **FR-009**: The installer MUST capture the domain from, in priority order: an explicit argument, an environment value, an existing persisted value, or an interactive prompt.
- **FR-010**: The interactive prompt MUST work even when the installer is run via a piped command (e.g. `curl | bash`), not only when run as a local file.
- **FR-011**: The installer MUST fall back to a local/default domain only when no domain is supplied AND no interactive terminal is available, and MUST emit a clear warning when it does.
- **FR-012**: The captured domain MUST be persisted to the platform's configuration that the running stack reads (not to a transient shell-only location).

**Cleanup & invariant**

- **FR-013**: The platform MUST remove the unused two-source domain-resolution fallback (the unreachable code that compared two domain values) and any reference to it.
- **FR-014** (corollary of FR-003): Changing the domain after install MUST be a deliberate re-install operation and MUST NOT be possible through the setup or dashboard flow.

### Key Entities

- **Authoritative domain**: the single domain value chosen at install and persisted to the platform configuration (environment); read **directly** by every component (routing, identity, dashboard, APIs, certificate). The previously-separate stored domain value (database column) is removed.
- **Required DNS records**: the apex address record, the wildcard address record, and the certificate-challenge (TXT) record the operator must create for the domain.
- **Certificate**: the certificate issued for the domain and its subdomains after DNS verification (issuance flow unchanged).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The operator enters the domain **exactly once** (at install) and never again — `/setup` presents **zero** domain-entry fields.
- **SC-002**: The running platform exposes **exactly one** domain value, with **no** reachable path (UI or API) that can produce a second, divergent value.
- **SC-003**: An operator installing via the common piped command is prompted for (or must supply) the domain and does **not** silently end up on a default/local domain.
- **SC-004**: From a correctly-installed platform, the operator reaches an HTTPS dashboard by only adding the shown DNS records and creating an admin — with **no** configuration-file edits.
- **SC-005**: The previously-dead two-source domain-resolution fallback is removed — **zero** references remain and no behavior depends on it.
- **SC-006**: On opening `/setup` with a domain established, the required DNS records for that domain are shown within 2 seconds, with no domain-entry step in between.

## Assumptions

- **Domain is an install-time decision** (terminal), not a browser choice; choosing the domain in the browser or changing it live is **out of scope** (a deliberate re-install). This is the conscious trade vs the heavier Option-2 / setup-first approach.
- **Boot model unchanged**: the platform still boots with the domain already known (as today). This feature removes the duplicate entry + dead fallback and unifies the source; it does **not** introduce apex-less boot, staged activation, or service deferral.
- **Existing flows reused unchanged**: DNS-based domain-ownership verification, certificate issuance, and admin-account creation are reused as-is; only the domain-**entry** step is removed and the domain **source** is unified.
- **Local/default domain remains valid** for local/offline testing, but only as a warned, last-resort fallback (no interactive terminal + no domain supplied) — never a silent default. `/setup` **cannot be completed** on a local/default domain; it blocks until a real domain is set at install (per clarification).
- **The ~20 components that read the domain from the database today** are repointed to the authoritative install-time value and the database domain column is **removed** (an explicit, idempotent destructive schema change); behavior is unchanged because the value they now read equals what was previously stored.
