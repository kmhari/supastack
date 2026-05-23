# Feature Specification: Wildcard TLS Cert via DNS-01 During /setup

**Feature Branch**: `004-wildcard-cert-dns01`

**Created**: 2026-05-23

**Status**: Clarified

**Input**: User description: "read issue #2 and implement wild card cert during setup and reset the vm after testing it so that we can test the sign up properly"

**Cross-refs**: GitHub issue [kmhari/selfbase#2](https://github.com/kmhari/selfbase/issues/2)

## Clarifications

### Session 2026-05-23

- Q: Should selfbase use manual DNS-01 (operator adds TXT records themselves) or automated Cloudflare API (selfbase creates TXT records automatically)? → A: Manual DNS-01 — wizard shows TXT record values; operator adds them at their registrar; works with any DNS provider. Cloudflare API automation tracked separately in issue #6.
- Q: What is the renewal strategy for v1? → A: Manual renewal — dashboard alert ≥30 days before expiry; operator clicks "Renew" to get new TXT records and re-completes the flow. Automated renewal lands in issue #6.
- Q: How should cert/key files be shared between the API and Caddy containers? → A: New `certs-data` Docker volume mounted at `/var/selfbase/certs` in both `api` (write) and `caddy` (read).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Issue a wildcard certificate during the first-time setup wizard (Priority: P1)

A new operator stands up a fresh selfbase host, points their domain at it, and walks the `/setup` wizard. Today, the wizard collects the apex domain, verifies DNS, and tells the operator certificates will be issued on-demand for each subdomain. The operator clicks Continue and starts using the platform — the first time anyone hits `<ref>.<apex>` or `studio-<ref>.<apex>` after a new project is created, they pay a 3-5 second ACME handshake penalty, and at scale Let's Encrypt's per-subdomain rate limits become a real concern.

This story adds a new step. After verifying the apex DNS, the wizard displays **two DNS TXT records** the operator must add at their DNS registrar (any provider). The operator adds the records, clicks "Verify", and the platform validates they are visible in public DNS and completes the ACME DNS-01 challenge, issuing a single `*.<apex>` + `<apex>` certificate. From then on every subdomain on the deployment — current and future — is covered by that one certificate. No per-subdomain ACME issuance occurs while the wildcard is valid.

**Why this priority**: Every other reason for filing this issue (Postgres-over-SNI in issue #3, removing first-request latency, killing per-subdomain rate-limit pressure) collapses out the moment the wildcard exists. Without it, none of those follow-up features are practical. This is the foundational change.

**Independent Test**: A clean Ubuntu host with no prior selfbase state can be brought up from `install.sh`, walked through `/setup` including the new DNS-01 step, and immediately serve traffic at every existing and any newly-provisioned subdomain with a valid `*.<apex>` certificate — verifiable via `curl -v https://<any-new-subdomain>.<apex>` showing `subject: CN=*.<apex>` from Let's Encrypt within 60 seconds of the operator completing the TXT verification step.

**Acceptance Scenarios**:

1. **Given** a fresh host with the apex DNS A record configured to point at the public IP, **When** the operator completes the standard /setup wizard including the new DNS-01 TXT step, **Then** the platform issues a `*.<apex>` + `<apex>` certificate from Let's Encrypt, and the dashboard is reachable at `https://<apex>/dashboard` with that certificate.
2. **Given** a deployment with a wildcard certificate already issued, **When** the operator provisions a brand-new project, **Then** the new subdomain `<new-ref>.<apex>` answers HTTPS on the FIRST request with the existing wildcard certificate — zero per-subdomain ACME handshake, zero first-request latency.
3. **Given** the operator adds incorrect TXT values (or none at all), **When** they click "Verify", **Then** the wizard surfaces a clear failure ("TXT records not found — DNS may still be propagating or values are incorrect") and lets the operator retry or skip without leaving the wizard or corrupting state.
4. **Given** a deployment running on a wildcard certificate approaching expiry, **When** the certificate is within 30 days of expiry, **Then** the dashboard displays an actionable alert and the operator can click "Renew" to re-run the TXT verification flow and obtain a new certificate.
5. **Given** an existing selfbase host that was set up before this feature shipped (i.e. running on per-subdomain on-demand TLS), **When** the operator navigates to the TLS settings in the dashboard and initiates a wildcard cert request, **Then** the platform runs the same TXT-challenge flow, issues the wildcard, and existing on-demand certificates continue to serve traffic until natural expiry without disruption.

---

### User Story 2 — Verify signup still works after VM reset and re-setup (Priority: P1)

The operator needs confidence that this feature doesn't quietly break the existing signup → /setup flow on a clean host. The natural way to gain that confidence: reset the host to a pre-install state and walk the entire signup workflow end-to-end with the new wizard step in place.

**Why this priority**: The /setup wizard is the only path into selfbase for a new operator. If this change accidentally introduces a step ordering issue, a validation regression, or any other speed-bump in signup, the platform becomes harder to adopt — directly counter to the goal of the feature.

**Independent Test**: From a state where `/setup/status` returns `{ open: true }` (i.e. no super-admin exists yet), a fresh operator walks the wizard, supplies the required information (admin credentials, apex domain, TXT records for wildcard cert), and ends at a fully provisioned dashboard with a wildcard cert in place. Total wall-clock time from form-fill to dashboard-loaded should be under 3 minutes excluding DNS propagation wait (which is operator-side).

**Acceptance Scenarios**:

1. **Given** a wiped host where the control-plane database has no `setup_state.completed_at` timestamp, **When** an operator navigates to any selfbase URL, **Then** they are sent to `/setup`.
2. **Given** an operator on the `/setup` admin-credentials step, **When** they submit valid email + password + organization name, **Then** they advance to the apex-domain step (existing behavior, unchanged).
3. **Given** an operator with a valid apex domain configured and DNS verified, **When** they advance past the apex step, **Then** they land on the new DNS-01 certificate step which displays the TXT records to add.
4. **Given** an operator on the DNS-01 certificate step, **When** they add the TXT records at their registrar and click "Verify", **Then** they see a live status card walking through "Checking DNS records → TXT records found → Completing ACME challenge → Certificate issued" with each step succeeding or showing a clear error.
5. **Given** the wildcard cert has been issued, **When** the wizard completes and `setup_state.completed_at` is set, **Then** the operator is taken to the dashboard, and `/setup/status` returns `{ open: false }` from that point on.

---

### Edge Cases

- The operator adds the TXT records but DNS propagation hasn't reached public resolvers (1.1.1.1, 8.8.8.8) yet: the wizard MUST surface a "still propagating" message with a retry button, not fail permanently. Reasonable polling: wizard auto-checks every 10 seconds; manual "Check again" button also available.
- The operator picks "Skip for now" (link at bottom of DNS-01 step): the deployment falls back to the existing per-subdomain on-demand TLS path. `/setup` completes. Adding the wildcard later via the dashboard TLS settings screen remains an option.
- The operator adds only one of the two TXT values (ACME requires both `apex` and `*.apex` challenges): the DNS check will report which record(s) are still missing, with the exact expected name and value shown for each.
- Let's Encrypt fails the challenge even after TXT records are confirmed visible (e.g. LE's validator is lagging): the wizard shows the ACME error response and offers retry without requiring the operator to re-add TXT records (the ACME order is resumed, not restarted).
- The wildcard certificate exists and the operator initiates renewal but forgets to update the TXT records for 30+ days: the old cert continues serving (Let's Encrypt 90-day validity); the dashboard alert remains visible until the operator completes renewal.
- Multiple wildcard certs (e.g. when an apex is changed): out of scope. The /setup wizard binds one apex per deployment; apex change is a separate operation not covered here.
- ACME rate limits: Let's Encrypt allows 5 duplicate certificate orders per week. If the operator repeatedly fails and retries, the platform MUST surface the LE rate-limit error rather than silently failing.

## Requirements *(mandatory)*

### Functional Requirements

#### DNS-01 Certificate Step

- **FR-001**: Selfbase MUST extend the existing `/setup` wizard with a new step for wildcard certificate issuance. The step appears after apex-DNS A-record verification and before /setup is marked complete. The step is skippable — the operator may proceed without a wildcard certificate.
- **FR-002**: The DNS-01 step MUST display to the operator all TXT record(s) required by the ACME DNS-01 challenge for both `<apex>` and `*.<apex>`. For each record, the wizard MUST show: the exact hostname to add (`_acme-challenge.<apex>`), the exact value(s) to set, the suggested TTL (60 seconds), and a clear instruction that both values must be present as a multi-value TXT record on the same hostname. The wizard MUST NOT require the operator to know their DNS provider's API — this step is provider-agnostic and works with any registrar.
- **FR-003**: The wizard MUST validate TXT record presence using public DNS resolvers (1.1.1.1, 8.8.8.8) before attempting to complete the ACME challenge. Validation MUST confirm all required challenge values are visible. If any value is missing, the wizard MUST report which specific record is not yet visible and offer retry without abandoning the ACME order. Only after all records are confirmed visible does the platform proceed to complete the ACME challenge with Let's Encrypt.
- **FR-004**: The platform architecture MUST be designed so that future automated DNS provider integrations (e.g. Cloudflare API automation tracked in issue #6, Route 53, etc.) can be added as optional enhancements to this flow without restructuring the core ACME issuance logic. Manual DNS-01 is the v1 baseline; provider-specific automations are additive.
- **FR-005**: An operator MUST be able to initiate a new wildcard certificate from a designated dashboard settings area at any time after /setup, without going through /setup again. This covers both adding a wildcard to a deployment that initially skipped it and renewing an expiring certificate.

#### Wildcard Certificate Issuance

- **FR-006**: Once the TXT records are confirmed in DNS, selfbase MUST complete the ACME DNS-01 challenge, finalize the certificate order, and download the issued `*.<apex>` + `<apex>` certificate from Let's Encrypt. The operator MUST see live progress through each stage. The issued certificate and its private key MUST be written to the shared `certs-data` volume and loaded by Caddy via `tls.certificates.load_files`.
- **FR-007**: The platform MUST alert the operator via a dashboard-visible notice when the wildcard certificate is within 30 days of expiry. The notice MUST include the exact expiry date and a one-click link to the renewal flow. The operator completes renewal by re-running the TXT verification step and obtaining a new certificate. Fully automated renewal (without operator action) is deferred to issue #6 (Cloudflare API integration).
- **FR-008**: When the wildcard certificate exists and is loaded by Caddy, ALL configured subdomains — apex, per-instance data-plane subdomains, per-instance Studio subdomains, the management-API subdomain, and any future selfbase-managed subdomains under the apex — MUST be served from that single certificate. No per-subdomain ACME issuance MUST occur while the wildcard is valid and loaded.

#### Backward Compatibility

- **FR-009**: Deployments that have no wildcard certificate MUST continue to function. The existing per-subdomain on-demand TLS path remains as the fallback. The dashboard MUST surface a prompt encouraging the operator to issue a wildcard certificate, with a one-click link to the certificate settings screen.
- **FR-010**: Existing per-subdomain certificates issued before the wildcard was provisioned MUST NOT be invalidated. They MAY remain in Caddy's storage but the wildcard cert takes precedence via SNI connection policies. The transition MUST be transparent to end users — no service interruption, no broken connections.
- **FR-011**: An operator with an active wildcard certificate MUST be able to DISABLE it and revert to the on-demand TLS path. The revert MUST be surfaced as an explicit operator action (not an accidental side-effect of cert expiry).

#### Operator Visibility & Recovery

- **FR-012**: The dashboard MUST show the current TLS state — wildcard cert issuer, SAN list, expiry date, and the mode currently in use (wildcard or per-subdomain on-demand) — in a way that lets the operator answer "is my TLS healthy?" without consulting logs or the Caddy admin API.
- **FR-013**: When the wildcard certificate is within 30 days of expiry, selfbase MUST display a dashboard-visible alert listing the expiry date and a direct link to the renewal flow. The alert MUST remain visible until the operator either renews the certificate or explicitly dismisses it.
- **FR-014**: A failed renewal attempt MUST NOT crash or destabilize the platform. The existing certificate continues serving traffic until it fully expires. The platform MUST show the failure reason in the dashboard.
- **FR-015**: Selfbase MUST log every certificate issuance and renewal event (start, finish, outcome, error if any) to its existing audit log so the operator has a verifiable history of TLS state transitions.

#### Verification Workflow

- **FR-016**: To enable end-to-end testing of the new /setup flow, the implementation MUST be deployable to a wiped host where the entire selfbase stack has been torn down and re-installed from scratch. After the reset, the operator MUST be able to walk the full signup → /setup → DNS-01 wildcard-issuance flow and end at a working dashboard.

### Key Entities

- **Wildcard Certificate**: The active ACME order and resulting TLS certificate for `<apex>` and `*.<apex>`. Tracks ACME order state (`awaiting_dns`, `verifying`, `issued`, `failed`), the challenge TXT record name and values shown to the operator, the ACME account key (encrypted at rest), the issued certificate PEM, the private key PEM (encrypted at rest), expiry timestamps, and the last error if any.
- **Cert Renewal Event**: A record of each issuance or renewal attempt — who triggered it, when it started and finished, the outcome, and any error message. Surfaces in the dashboard TLS health view.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator on a clean host can initiate the DNS-01 wizard step, add the TXT records, click Verify, and reach a working dashboard with a wildcard cert in under 3 minutes of active interaction time (excluding DNS propagation wait, which is outside the platform's control).
- **SC-002**: After the wildcard is issued, the first HTTPS request to any newly-created per-instance subdomain (`<ref>.<apex>`, `studio-<ref>.<apex>`, `api.<apex>`, or any future selfbase-managed subdomain) returns the response body in under 500 milliseconds end-to-end — no per-subdomain ACME handshake penalty.
- **SC-003**: Across a deployment with 50 active instances, the platform serves all subdomains from exactly one wildcard certificate. Verified by confirming `CN=*.<apex>` on TLS handshakes to multiple subdomains.
- **SC-004**: An operator with a wildcard certificate expiring within 30 days sees a dashboard alert with the expiry date and a renewal link. Verified by inspecting the dashboard on a deployment whose cert `notAfter` is < 30 days from now.
- **SC-005**: After a host wipe and full re-setup with the new DNS-01 step, the existing user-signup → instance-provision → CLI-deploy flow continues to work end-to-end without any operator-visible regression. Verified by running the production smoke-test sequence post-reset.
- **SC-006**: The platform survives an ACME order that fails (e.g. TXT not yet visible) — the operator can retry within the wizard without restarting /setup, and no stuck state prevents either on-demand or wildcard TLS from working.
- **SC-007**: Operators who skip the DNS-01 step entirely end up on a working deployment using the existing on-demand TLS path. Selfbase remains fully usable without a wildcard; the wildcard is an opt-in optimization.

## Assumptions

- The existing /setup wizard's apex A-record DNS verification step remains the immediate predecessor of the new DNS-01 step. Verifying apex DNS is a prerequisite for issuing the wildcard — Let's Encrypt must be able to reach the ACME challenge DNS records for the apex.
- Operators have access to add TXT records at their DNS registrar. Operators with no DNS management access stay on per-subdomain on-demand TLS.
- The ACME DNS-01 challenge for both `apex` and `*.apex` in a single order requires two TXT values on the same `_acme-challenge.<apex>` record name. Both values must be present simultaneously for Let's Encrypt to validate both identifiers.
- The platform's existing master-key encryption mechanism is appropriate for protecting the ACME account private key and the issued certificate private key. No new key-management infrastructure is needed.
- "Reset the VM for re-setup testing" means: stop all selfbase containers, drop the control-plane Postgres data volume, wipe `/var/selfbase/instances/` and `/var/selfbase/certs/`, and remove any remaining Docker volumes. The host's outer DNS configuration (apex A record pointing at the VM IP) stays in place. This is a one-time pre-release validation activity.
- Let's Encrypt's ACME DNS-01 challenge validation may have a brief lag after the TXT records become visible in public DNS (~30 seconds in practice). The platform uses public DNS resolvers (1.1.1.1, 8.8.8.8) for its own DNS check, which closely matches what LE's validators observe.
- The `acme-client` npm package handles ACME account management (create-or-reuse semantics), order creation, authorization polling, and certificate download. Its behavior is treated as a dependency, not reimplemented.
