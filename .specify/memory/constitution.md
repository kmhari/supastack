<!--
SYNC IMPACT REPORT
==================
Version change: (unversioned template) → 1.0.0
Type: Initial ratification — placeholders replaced with concrete supastack principles
       derived from the established conventions in CLAUDE.md.

Principles defined (6):
  I.   Idempotent, Additive Schema Evolution
  II.  Secrets Stay Encrypted, Master Key Stays Home
  III. Authorize Every Privileged Action
  IV.  Supabase Compatibility Is a Pinned Contract
  V.   The Worker Owns Per-Instance State
  VI.  Spec-Driven, Evidence-Based Delivery

Added sections:
  - Platform Architecture Constraints
  - Development Workflow & Quality Gates
  - Governance

Removed sections: none (template placeholders fully replaced)

Templates reviewed:
  ✅ .specify/templates/plan-template.md — "Constitution Check" gate (line 39) reads this
       file generically; the six principles now populate that gate. No edit required.
  ✅ .specify/templates/spec-template.md — no conflict; spec stays WHAT/WHY, principles are
       enforced at plan/implementation time.
  ✅ .specify/templates/tasks-template.md — no conflict; principle-driven task types
       (migrations, RBAC, contract tests) are already expressible.

Deferred TODOs: none.
-->

# Supastack Constitution

Supastack is a self-hosted, multi-project Supabase platform: one operator provisions N isolated
Supabase projects on a single VM, with dashboard + CLI compatibility close enough to Supabase Cloud
that the upstream tooling works. These principles are the non-negotiable rules that keep that
promise safe, compatible, and maintainable.

## Core Principles

### I. Idempotent, Additive Schema Evolution

Every database migration MUST be idempotent: re-running the entire migration sequence any number of
times MUST produce the same result as running it once. Use `IF NOT EXISTS`, `ADD CONSTRAINT IF NOT
EXISTS`, `CREATE OR REPLACE`, and guarded `DO` blocks — never a bare `CREATE`/`ALTER` that fails on
second run. Schema changes MUST be additive unless a change is explicitly and intentionally
destructive: new columns are nullable and backfilled in a separate step; widening an enum/CHECK is
done by dropping and recreating the constraint with the larger set. A migration that cannot be
re-applied cleanly is a defect, not a style choice.

**Rationale**: The platform is redeployed by re-running migrations against live operator data on a
single VM. Non-idempotent or destructive migrations risk irreversible data loss with no staging tier
to catch them.

### II. Secrets Stay Encrypted, Master Key Stays Home

All per-instance and user secrets MUST be stored encrypted at rest via master-key envelope
encryption (`encryptedSecrets bytea`, decrypted at use time with `decryptJson(buf,
loadMasterKey())`). The master key MUST never leave the api container, never be written to disk in
plaintext, never appear in logs, URLs, query strings, or commits. Derived keys (JWT signing, etc.)
MUST come from the master key via HKDF with a distinct label rather than introducing new standalone
secrets. Plaintext secrets are shown to an operator at most once and never persisted in the clear.

**Rationale**: A single VM hosting many tenants is a concentrated blast radius; leaking the master
key or a stored secret compromises every project at once.

### III. Authorize Every Privileged Action

Every privileged endpoint MUST declare an action in the central RBAC matrix
(`packages/shared/src/rbac.ts`) and gate execution with `app.authorize(req, <action> [, orgId])`.
The matrix is the single source of truth for permission decisions; every role × action cell MUST be
explicitly defined and exhaustively covered by a contract test. Authorization that lives only in
hand-written endpoint logic, or a new privileged endpoint with no matrix action, is non-compliant.

**Rationale**: Multi-tenant, multi-operator access is only safe when every decision flows through one
auditable, testable table — not scattered, drifting checks.

### IV. Supabase Compatibility Is a Pinned Contract

The Management API surface (`/v1/*`) MUST conform to the upstream Supabase OpenAPI for the endpoints
it implements: paths, request/response shapes, and validation bounds. A pinned upstream snapshot MUST
live under the feature directory and be guarded by a contract test so drift is caught mechanically,
not discovered in production. The dashboard API (`/api/v1/*`) is a separate surface with its own
error envelope. Supabase CLI and MCP wire compatibility MUST NOT regress; changes that touch those
paths require explicit regression coverage.

**Rationale**: Supastack's value is that the real `supabase` CLI, Studio, and MCP clients "just
work." Silent divergence from the upstream contract breaks that for users with no warning.

### V. The Worker Owns Per-Instance State

Changes to per-instance (data-plane) state MUST flow through the worker as one BullMQ job per
concern (`apps/worker/src/jobs/`), registered once at boot. The api performs only synchronous admin
actions that need immediate operator feedback (e.g. password reset) directly; everything else —
provisioning, lifecycle, backups, cert renewal, pooler reconciliation — is a worker job. Repeatable
jobs are declared once with an explicit schedule.

**Rationale**: Long-running, failure-prone container orchestration must be retryable, observable, and
isolated from the request path so an api restart or a single slow operation cannot wedge the platform.

### VI. Spec-Driven, Evidence-Based Delivery

Every non-trivial feature MUST begin with a spec under `specs/<NNN-name>/` (spec → plan → tasks →
implement); implementation marks tasks complete against that spec. Security-sensitive logic MUST have
unit tests (pure functions preferred); integration paths are covered by the live-VM E2E scripts.
Outcomes MUST be reported faithfully — a failing test is stated with its output, a skipped step is
named, and "done" means verified. Claims like "faster" or "secure" require evidence, not assertion.

**Rationale**: Spec-first work keeps a broad, compatibility-sensitive platform coherent across many
features; honest, evidence-backed reporting is what makes that history trustworthy.

## Platform Architecture Constraints

- **One compose stack**: the control plane (`db`, `redis`, `api`, `worker`, `web`, `caddy`,
  `supavisor`, plus shared services) runs as a single Docker Compose stack. Per-project data planes
  are separate container sets namespaced `supastack-<ref>-*`.
- **Isolation**: each project gets its own Postgres, Auth, Storage, Realtime, Functions, etc. No
  project may read another project's data or secrets.
- **Edge/TLS**: external traffic terminates at Caddy using the wildcard `*.<apex>` cert (DNS-01) plus
  per-project ACME where strict-TLS clients require it. Routing config is generated from DB state and
  loaded atomically.
- **Ports**: per-instance ports are allocated dynamically from `port_allocations`; only the fixed
  host listeners (Caddy 80/443, the pg-edge-proxy 5432, Supavisor 6543) are static.
- **Installation vs tenant**: installation-level settings (apex domain, backup destination) are
  singletons and MUST remain separate from tenant organizations.

## Development Workflow & Quality Gates

- **Spec lifecycle**: `/speckit-{specify,clarify,plan,tasks,implement}` under `specs/<NNN-name>/`.
- **Migration gate**: new `packages/db/migrations/*.sql` MUST be idempotent and additive (Principle I).
- **RBAC gate**: a new privileged endpoint MUST add a matrix action + `authorize()` call (Principle III).
- **Compatibility gate**: changes to `/v1/*` MUST update the pinned OpenAPI snapshot and pass the
  contract test (Principle IV).
- **Testing posture**: `any` is permitted in test code only (scoped off in `eslint.config.js` for
  `**/tests/**`); production code MUST remain typed. Prefer pure functions for unit coverage; reserve
  live-VM E2E for integration paths.
- **Deployment**: rsync source to the VM, then `docker compose build <service> && docker compose up
  -d <service>`; never clobber a per-instance stack by omitting its `-p supastack-<ref>` project name.

## Governance

This constitution supersedes ad-hoc convention where they conflict. Amendments are made by editing
this file in a pull request, with a semantic-version bump and an updated Sync Impact Report:

- **MAJOR**: a principle is removed or redefined in a backward-incompatible way.
- **MINOR**: a principle or governing section is added or materially expanded.
- **PATCH**: clarifications, wording, or non-semantic refinements.

Compliance is verified during review: a change that violates a principle MUST either be brought into
compliance or carry an explicit, justified exception recorded in the feature's plan
(`Complexity Tracking`). Runtime, day-to-day development guidance lives in `CLAUDE.md`; where it and
this constitution disagree, the constitution governs.

**Version**: 1.0.0 | **Ratified**: 2026-06-02 | **Last Amended**: 2026-06-02
