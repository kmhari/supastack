# Feature Specification: Supabase CLI Compatibility — P0 (Login, Link, Functions Deploy, Secrets)

**Feature Branch**: `003-supabase-cli-compat-p0`

**Created**: 2026-05-22

**Status**: Draft

**Input**: User description: "lets focus on p0, i need login, supabase link, and functions deployment and secrets along"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Connect the official Supabase CLI to a selfbase deployment (Priority: P1)

A developer who already uses the official Supabase CLI for cloud projects wants to point that same binary at a selfbase deployment without installing a fork, building from source, or applying patches. They obtain a small configuration profile from their selfbase dashboard, drop it into a well-known location on their machine, paste in their selfbase access token, and from that moment on every command they run against the CLI (whether targeting selfbase or Supabase Cloud) routes to the correct backend.

**Why this priority**: Nothing else in this feature is usable until the official CLI can reach a selfbase backend at all. This is the foundation that the deploy and secrets stories depend on. Without it, the user must rely on web UI or hand-rolled scripts for every operation, defeating the purpose of CLI compatibility.

**Independent Test**: A developer with a working selfbase deployment and the unmodified upstream Supabase CLI installed can — by following the on-screen instructions in the selfbase dashboard — configure their CLI to talk to selfbase, run a command that requires authentication (such as listing their projects), and see their selfbase projects returned. No source code changes to the CLI are required at any point.

**Acceptance Scenarios**:

1. **Given** a developer has the official Supabase CLI installed and at least one project provisioned in selfbase, **When** they follow the dashboard's "Connect CLI" instructions and run the project-listing command targeted at their selfbase profile, **Then** they see a list of every selfbase project that belongs to them with the same identifiers shown in the selfbase dashboard.
2. **Given** a developer's selfbase access token is missing or revoked, **When** they run any CLI command that requires authentication, **Then** the CLI surfaces a clear authentication failure that tells the developer their token is invalid or absent, without crashing or producing an opaque error.
3. **Given** a developer already uses the same CLI binary against Supabase Cloud, **When** they switch their active profile to selfbase, run commands, then switch back, **Then** each command routes to the matching backend and the developer's cloud session is not disturbed by the selfbase setup.
4. **Given** the selfbase dashboard surfaces the CLI connection instructions, **When** a developer opens that page, **Then** they see step-by-step guidance, the exact profile content for their deployment, and a way to copy each piece to their clipboard.

---

### User Story 2 — Link a local project directory to a remote selfbase project (Priority: P1)

A developer has a checkout of their application code with a `supabase/` folder (functions, migrations, config) and wants to bind that folder to a specific selfbase project so that subsequent commands act on the right backend automatically. They run the standard linking command from the upstream CLI, identify their project by its short reference, and from then on commands they run in that directory operate against the linked project without needing the project reference re-specified each time.

**Why this priority**: Linking is the second-step the CLI walks every user through, and every per-project command (deploy, secrets, type generation) expects a linked project. Skipping it forces the user to pass the project reference flag on every single command — a degraded experience that erodes the value of using the CLI.

**Independent Test**: After Story 1 is complete, a developer runs the link command against a known selfbase project reference, sees a success message, and the next command they run in that directory (such as listing functions for the implicit project) addresses the correct selfbase project without needing the reference flag.

**Acceptance Scenarios**:

1. **Given** a developer is in a directory with a `supabase/` folder and has configured their selfbase profile, **When** they run the link command with a valid project reference, **Then** the CLI confirms the link, persists the binding in local files the same way it does for cloud projects, and subsequent commands target that project.
2. **Given** a developer passes a project reference that doesn't exist in their selfbase deployment, **When** they run the link command, **Then** the CLI reports that the project was not found in language familiar to anyone who has used the cloud CLI.
3. **Given** a developer is already linked to one project, **When** they re-run the link command with a different project reference, **Then** the new link replaces the old one and a confirmation message reflects the new binding.

---

### User Story 3 — Deploy edge functions to a selfbase project (Priority: P1)

A developer with a linked project and one or more edge function source folders under `supabase/functions/` wants to run a single deploy command and have those functions become reachable on their selfbase project's public URL within seconds. They expect the same workflow they use for Supabase Cloud: bundle locally, upload, and receive a confirmation with the function URL. They expect to be able to redeploy a function many times, deploy a brand-new function for the first time, and delete a function they no longer need.

**Why this priority**: Edge functions are the headline reason the user asked for CLI compatibility — it is impossible to deploy functions to a self-hosted Supabase stack through any other supported workflow today. Every other P1 in this spec is in service of unblocking this one.

**Independent Test**: With a linked project and a `supabase/functions/hello/` folder containing a simple handler, the developer runs the deploy command for that one function. Within ten seconds the command succeeds, prints the function's public URL, and a curl request to that URL returns the handler's output.

**Acceptance Scenarios**:

1. **Given** a linked project and a single function source folder, **When** the developer runs the deploy command for that function by name, **Then** the function is uploaded, becomes immediately reachable at its public URL, and the CLI prints that URL alongside a success message.
2. **Given** a linked project and multiple function folders, **When** the developer runs the deploy command without naming a specific function, **Then** every function under `supabase/functions/` is deployed in the same invocation and each one's status is reported.
3. **Given** a function was previously deployed and the developer has changed its source, **When** they re-run the deploy command for that function, **Then** the new version replaces the old one and is reachable at the same URL within the same time budget as the initial deploy.
4. **Given** a function exists in the project but its source folder has been removed locally and the developer asks the CLI to delete it, **When** the delete command runs against that function name, **Then** the function is removed from the project and stops responding at its public URL.
5. **Given** the deploy fails — bad bundle, missing entrypoint, runtime rejecting the upload — **When** the CLI returns, **Then** the developer sees a specific reason for the failure and the project's previously-deployed functions are unaffected.
6. **Given** the developer asks the CLI to list deployed functions for the linked project, **When** the list command runs, **Then** they see the same function names, slugs, and status indicators as on the dashboard's functions page.
7. **Given** the developer wants to inspect a deployed function's source, **When** they ask the CLI to download a specific function, **Then** the CLI writes the function's source files to a local directory that mirrors the layout `supabase/functions/<name>/`.

---

### User Story 4 — Manage runtime secrets used by edge functions (Priority: P1)

A developer needs to give their deployed edge functions access to API keys, database credentials, or service tokens at runtime. They expect the same CLI workflow they use for Supabase Cloud: set a secret by name and value, list every secret currently configured (without seeing the values), and unset a secret by name. After setting a secret, the next invocation of any edge function in that project must be able to read the secret from its runtime environment.

**Why this priority**: Edge functions without secrets are usable only for trivial cases. Most real functions need at least one secret (Stripe key, OpenAI key, third-party webhook signing secret). Shipping functions without shipping secrets management would leave the deploy story half-built.

**Independent Test**: After Story 3 is complete, a developer sets a secret called `EXAMPLE_KEY` to a known value, deploys a one-line function that reads that environment variable and returns it, and a curl to the function's URL returns the known value. Unsetting the secret and re-invoking the function returns an absence indicator (empty string, missing, or whatever the runtime treats as not-set).

**Acceptance Scenarios**:

1. **Given** a linked project, **When** the developer sets a secret by name and value through the CLI, **Then** the CLI confirms the secret was stored and subsequent function invocations can read that name from the runtime environment without redeploying the function.
2. **Given** a linked project with several secrets configured, **When** the developer lists secrets, **Then** they see every secret's name and, for each, an obviously-redacted indicator of the value (such as a hash or "***"), never the plain value.
3. **Given** a linked project with secrets configured, **When** the developer unsets a secret by name, **Then** the secret is removed and subsequent function invocations no longer find it in their environment.
4. **Given** a developer wants to provide many secrets at once (such as from a `.env` file), **When** they hand the CLI a file of name/value pairs, **Then** all secrets are stored in a single command and the CLI reports how many were stored, replaced, or rejected.
5. **Given** the developer tries to set a secret with a reserved or invalid name (such as one of the system-managed variables the runtime sets automatically), **When** the set command runs, **Then** the CLI refuses with a message naming the conflict, rather than silently overwriting a runtime-critical variable.

---

### Edge Cases

- An expired or revoked selfbase access token is used: CLI surfaces a token-failure error consistently across every authenticated command, regardless of which command was invoked.
- The developer's profile file is malformed (missing fields, invalid URL, wrong type): the CLI's existing profile-validation rejects it before any HTTP call is made, with a message that identifies the bad field.
- The developer deploys a function whose bundle exceeds whatever upload size limit selfbase configures: the failure is reported with the actual size and the configured limit, not as a generic upload error.
- The developer runs a per-project command (deploy, secrets) without first linking, and without passing an explicit project reference: the CLI's existing flow surfaces this and prompts for `--project-ref`, identical to the cloud experience.
- Concurrent deploys to the same function: the later deploy wins, the earlier one's result is invalidated, no half-deployed state is left behind, and no requests in flight to the old version are interrupted mid-response.
- Setting a secret with a name that is already managed by the platform (for example, a database URL the runtime constructs automatically): the CLI refuses with a clear naming-conflict error.
- An edge function that was deployed but whose project has been deleted or paused: list/deploy/secrets commands report the project state cleanly, not as a 404 of unknown origin.
- A selfbase deployment that is briefly unreachable mid-command (TLS not yet provisioned, container restart, network blip): the CLI retries within a reasonable budget and only after that surfaces a network error with the actual underlying cause, not a generic timeout.
- The user has both a Supabase Cloud session and a selfbase profile configured, and accidentally runs a selfbase-targeted command against their cloud token: the CLI uses the active profile's token, not a stale cloud one, and selfbase's API rejects any cloud token cleanly.

## Requirements *(mandatory)*

### Functional Requirements

#### Profile and Authentication

- **FR-001**: The selfbase backend MUST expose a public network surface compatible with the upstream CLI's profile mechanism, such that a developer can configure the CLI to send all management-API calls to selfbase by writing a single profile file containing the deployment's API URL, dashboard URL, and project host.
- **FR-002**: The selfbase dashboard MUST present a "Connect CLI" view that gives the developer, for their specific deployment, the exact profile content to drop into the CLI, the exact command to make the CLI use that profile, and an access token bound to their selfbase account.
- **FR-003**: Selfbase MUST issue access tokens that the CLI presents as bearer credentials, and the backend MUST validate those tokens on every authenticated request, rejecting expired, revoked, or unrecognized tokens with the same response shape the cloud CLI's error handler already understands.
  - **FR-003a (token format constraint)**: The plaintext PAT handed to the user MUST match the upstream CLI's hard-coded client-side regex: `^sbp_(oauth_)?[a-f0-9]{40}$` — that is, the literal prefix `sbp_` (optionally followed by `oauth_` for OAuth-issued tokens, which selfbase does not use in P0) and then exactly 40 lowercase hexadecimal characters (20 bytes of randomness). Tokens that do not match this pattern are rejected by the CLI before any network call is made; selfbase has no opportunity to influence the validation. Empirically verified against the upstream CLI v2.72.7. The hashed form stored at rest is unconstrained.
- **FR-004**: The CLI's existing login command (which writes the access token into the OS keyring or a local credentials file under the active profile name) MUST work unchanged once the profile is in place. The user obtains the token from selfbase and pastes it when the CLI prompts for it.

#### Project Listing and Linking

- **FR-005**: Selfbase MUST expose, on its management-API surface, the operation that returns the list of projects the authenticated token may access. The returned project objects MUST carry, at minimum, the project reference, project name, organization identifier, region, and creation timestamp — the fields the upstream CLI consumes when offering link or selection UI.
- **FR-006**: Selfbase MUST expose the operation that returns a single project's metadata by reference, returning the same shape the CLI expects when verifying that a reference is valid and resolving project-level settings during a link.
- **FR-007**: When a developer runs the link command against a valid selfbase project reference, the CLI MUST persist the binding using its existing local-file mechanism and subsequent commands in that directory MUST operate against the bound project. When the reference is invalid, the CLI MUST surface a not-found error indistinguishable in shape from the cloud equivalent.

#### Edge Function Deployment

- **FR-008**: Selfbase MUST expose the function-deploy operation the upstream CLI calls, accepting the same bundle format the cloud accepts (a multipart upload composed of a manifest plus the function source bundle), and applying that bundle to the project's edge runtime such that the function becomes reachable at its public URL.
- **FR-009**: Selfbase MUST expose the operation that lists every function deployed to a given project, returning each function's slug, status, version identifier, and timestamps, matching the shape the CLI's list/sync workflow consumes.
- **FR-010**: Selfbase MUST expose the operation that retrieves a single deployed function's bundle/source by slug, sufficient for the CLI's download command to reconstruct the function's source layout on disk.
- **FR-011**: Selfbase MUST expose the operation that deletes a deployed function by slug, taking it off the public URL and removing it from the list. Once deleted, an immediate list call MUST no longer return that function.
- **FR-012**: Deploys MUST be atomic from the developer's perspective: either the new version of a function is fully live at its public URL, or the old version remains live and the CLI reports failure. There MUST be no in-between state where the function returns errors because of a half-applied deploy.
- **FR-013**: The deploy operation MUST tolerate the CLI deploying multiple functions in a single invocation, processing each one independently so that one failing function does not prevent the others from succeeding, and reporting a per-function status the CLI can render to the user.
- **FR-014**: After a successful deploy, the function's runtime environment MUST include every project-level secret currently set on the project (see Secrets requirements), so that the developer does not need to redeploy after setting a secret.

#### Secrets Management

- **FR-015**: Selfbase MUST expose the operation that lists every secret configured for a given project, returning each secret's name and an obviously-redacted indicator of its value. Plain secret values MUST NOT appear in list responses.
- **FR-016**: Selfbase MUST expose the operation that creates or replaces one or more secrets in a single call, accepting a list of name/value pairs and returning a per-entry success indicator. Setting a name that already exists MUST replace the value; the response MUST distinguish between "created" and "replaced".
- **FR-017**: Selfbase MUST expose the operation that deletes one or more secrets by name in a single call, returning a per-entry result so the CLI can report which names existed and were removed versus which did not exist.
- **FR-018**: A secret set or unset MUST be visible to every subsequent function invocation within a bounded propagation window. No redeploy of the function MUST be required to pick up a new or changed secret.
- **FR-019**: Selfbase MUST refuse to create a secret whose name collides with a system-managed runtime variable (the runtime's auto-injected URL, anon key, service-role key, JWT secret, database URL, and any equivalents that selfbase constructs per-instance). The refusal MUST be a clear API-level error, not a silent overwrite or a downstream runtime crash.
- **FR-020**: At-rest storage of secret values MUST use the same encryption boundary selfbase already applies to other per-instance secrets (master-key-encrypted blobs). Secrets MUST NOT be stored in plaintext on disk.

#### Compatibility and Response Shape

- **FR-021**: For every operation listed above, the response shape (HTTP status codes, JSON field names, field types, error envelopes) MUST be a strict subset of what the upstream CLI's generated client expects from the cloud management API for that same operation, so that the unmodified CLI parses selfbase responses without error.
- **FR-022**: The backend MUST honor authentication headers, content types, multipart boundaries, and pagination patterns the upstream CLI sends — selfbase MUST adapt to the CLI's wire format, not the other way around.
- **FR-023**: When the upstream CLI evolves and a new field is added that the selfbase backend has not yet implemented, the absence of that field MUST NOT crash the CLI: selfbase's responses MUST omit unsupported fields cleanly rather than emit invalid values.

#### Out-of-Scope Endpoint Behavior

- **FR-024**: For management-API endpoints the upstream CLI exposes but selfbase has not implemented in P0 (branches, custom hostnames, postgres-config, advisors, billing, network restrictions, type generation, etc.), the backend MUST return a clearly-shaped "not implemented for this deployment" error rather than an unhandled 404, so that the CLI's existing error-message logic can surface something coherent to the user. The error MUST identify the missing feature.

### Key Entities

- **Profile**: The CLI's view of a backend deployment. Carries the management-API URL, dashboard URL, project hostname pattern, and (optionally) the OAuth client identifier. Stored locally on the developer's machine and selected by name; never round-tripped to the server.
- **Access Token**: A bearer credential bound to a selfbase account that the CLI presents on every authenticated management-API call. Issued by selfbase, stored by the CLI under the active profile, revocable from the selfbase dashboard.
- **Project**: A selfbase-provisioned Supabase instance, identified by its short reference. Carries name, organization, region, creation timestamp, and the metadata required for CLI link/select flows.
- **Function**: A deployed edge function within a project, identified by its slug. Carries its current version identifier, deployment status, public URL, and timestamps.
- **Secret**: A name/value pair scoped to a project, exposed in the edge runtime environment of every function within that project. Lists return name plus redacted value; only the set/replace operation accepts the plain value, and only at request time.
- **Project Reference**: The short, dashboard-visible identifier for a project. Used by the CLI as the addressable key for every per-project operation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer who already has the upstream Supabase CLI installed can connect it to selfbase and successfully list their selfbase projects within three minutes of opening the dashboard's Connect-CLI view, without ever editing CLI source.
- **SC-002**: From the moment the link command succeeds, every P0 operation listed in this spec — `functions deploy`, `functions list`, `functions download`, `functions delete`, `secrets list`, `secrets set`, `secrets unset` — works against selfbase using the upstream CLI binary, with zero patches applied, zero forks installed, and zero shims at the OS level (no `/etc/hosts` tricks, no TLS interception).
- **SC-003**: A first-time edge-function deploy completes — from the moment the developer presses Enter to the moment the function answers its first request at its public URL — within fifteen seconds for a function whose source is under 100 KB and whose project is healthy.
- **SC-004**: A repeat deploy of an existing function (the common iteration case) completes within ten seconds.
- **SC-005**: After a secret is set, the next invocation of any function in that project sees the new value within five seconds, with no function redeploy required.
- **SC-006**: Across the full set of P0 commands, 95% of CLI runs against a healthy selfbase deployment complete without surfacing any error to the user that originates in shape-mismatch between selfbase responses and the CLI's parser. Errors the user does see come from genuine failures (bad input, missing auth, infra outage), not from compatibility drift.
- **SC-007**: A developer who has been using the cloud CLI can complete every P0 workflow against selfbase without consulting any selfbase-specific documentation beyond the dashboard's Connect-CLI page. Every command name, flag, prompt, and error message comes from the upstream CLI itself.

## Assumptions

- The official Supabase CLI's profile mechanism (built-in profiles plus a "load any file path as a profile" fallback) will remain in place and continue to support custom URLs without source modification. If upstream removes that mechanism in a future release, selfbase will need to track this and may need to either pin a CLI version range or revisit the approach.
- Selfbase already provisions each project with an edge-runtime container, a Kong gateway, and persistent storage on the host filesystem under a per-instance directory. The P0 implementation will land function bundles and secret values into those existing surfaces — no new long-running service is introduced.
- Developers using this feature already have a selfbase account, at least one provisioned project, and an environment where the upstream Supabase CLI runs successfully against Supabase Cloud. The feature does not undertake to install the CLI for them or set up their development environment.
- Function bundling (source → uploadable artifact) is done by the upstream CLI on the developer's machine. Selfbase receives the same bundle the cloud receives and is not responsible for compiling, type-checking, or import-map resolution.
- TLS certificates for the selfbase deployment's API surface are already in place via the existing apex setup wizard. The CLI requires HTTPS and a publicly trusted certificate; self-signed certs will not work without per-developer trust setup, which is out of scope for P0.
- Database-only CLI commands (`db push`, `db pull`, `migration *`, `inspect *`) already work against selfbase by passing `--db-url` explicitly. P0 does not change this. Making them work transparently after `link` (without `--db-url`) is a follow-up that requires exposing Postgres on a per-instance hostname.
- The CLI's telemetry/PostHog surface is unaffected by this feature: the upstream CLI's telemetry endpoint stays on its hardcoded host or is disabled by the user via the existing opt-out env var.
- Branches, custom hostnames, postgres-config, advisors, billing, vanity-subdomain, and other cloud-only management endpoints are explicitly out of scope for P0 and will return a structured "not implemented" error.
