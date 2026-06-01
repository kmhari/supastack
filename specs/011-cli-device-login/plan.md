# Implementation Plan: CLI device-code login

**Branch**: `011-cli-device-login` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)

## Summary

Implement the supabase CLI's PKCE-style browser login against supastack. New dashboard page at `/dashboard/cli/login` reads `session_id`/`token_name`/`public_key` from query string, auto-mints a PAT for the signed-in user, encrypts it with the client's ECDH-P256 public key via AES-256-GCM, stores the bundle in Redis under the session_id for 5 minutes, and displays an 8-hex verification code. New unauthenticated endpoint `GET /platform/cli/login/:session_id?device_code=…` on the api host returns the encrypted bundle for the CLI to decrypt + save. Single-use: Redis entry deleted on successful poll. Logged-out visitors bounce to `/login?next=…`. Replay attempts hit a deterministic error page. CLI-minted tokens go in the existing `api_tokens` table with a new `source = 'cli'` column; dashboard's tokens page renders a small `cli` badge next to them.

## Technical Context

**Language/Version**: TypeScript on Node 20 (api + worker), React 18 + Vite 5 (web), Deno on the per-project edge runtime (unaffected by this feature)

**Primary Dependencies**: Fastify (api), `@fastify/session` + `connect-redis` (existing session store — reuse for the CLI-login Redis namespace), Node 20 stdlib `node:crypto` (`createECDH('prime256v1')`, `createCipheriv('aes-256-gcm', …)`, `randomBytes`, `randomUUID`), Drizzle ORM (control-plane DB), React Router 6 + shadcn/ui (web), Vitest (tests)

**Storage**:
- **Redis** (existing `supastack:sess:*` connect-redis instance) — new key namespace `supastack:cli-login:<session_id>` with 300s TTL holds the encrypted bundle
- **Control-plane Postgres** — existing `api_tokens` table, adds one new nullable column `source` (`'manual' | 'cli'`, default `'manual'`)

**Testing**: Vitest unit tests for the crypto helpers (`cli-login-crypto.ts`) + the route handlers (mocked Redis + DB); existing pattern. Live-VM E2E shell script under `tests/cli-e2e/` to drive an actual `supabase login` round-trip via expect-style scripted input.

**Target Platform**: Same as the rest of supastack — single VM Docker compose. VM: `ubuntu@148.113.1.164`, apex `supaviser.dev`.

**Project Type**: Web application monorepo — extends existing `apps/api`, `apps/web`, `packages/db`, `packages/shared`.

**Performance Goals**:
- Dashboard page mint + render in ≤2s (SC-001 component)
- Polling endpoint response ≤100ms on cache hit (sub-100ms Redis GET + DEL + JSON serialize)
- End-to-end `supabase login` flow under 30s with browser already logged in (SC-001)

**Constraints**:
- Wire contract is **upstream-CLI dictated** — response body shape `{ id, created_at, access_token, public_key, nonce }` with all values as lowercase hex; ECDH P-256 + AES-256-GCM + 12-byte nonce; reject any deviation
- Polling endpoint cannot require auth headers (CLI is anonymous at that point) — security comes from UUID v4 + 32-bit device_code in 5-minute window
- No new third-party crypto dependencies (Node 20 stdlib has everything needed)
- Single-use: Redis DEL after one successful poll (prevents replay)
- Both admin + member roles can use (no new RBAC action; reuse existing PAT-create permission)
- Open-redirect prevention: `?next=` on login page must be same-origin relative path only

**Scale/Scope**:
- One operator per CLI flow; expected volume <10/day on a single-operator deployment
- Single-VM session store; no cross-region replication
- 5-minute TTL → max pending sessions in flight at any time bounded by operator activity

## Constitution Check

*GATE: N/A — project constitution at `.specify/memory/constitution.md` is the unfilled template (no ratified principles, same as previous features).*

No constraints to gate against. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/011-cli-device-login/
├── plan.md              # This file
├── spec.md              # Feature spec (with Clarifications session 2026-05-25)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── dashboard-mint-endpoint.md   # POST /api/v1/cli/login
│   ├── polling-endpoint.md           # GET /platform/cli/login/:session_id
│   ├── dashboard-page.md             # /dashboard/cli/login UI states
│   └── cli-wire-protocol.md          # the upstream-dictated wire contract reference
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # (Phase 2 — /speckit-tasks)
```

### Source Code (repository root)

```text
apps/
  api/
    src/
      routes/
        cli-login.ts                  # NEW — POST /api/v1/cli/login (dashboard mint)
        platform-cli-login.ts         # NEW — GET /platform/cli/login/:session_id (CLI poll)
      services/
        cli-login-crypto.ts           # NEW — ECDH P-256 + AES-256-GCM helpers + 8-hex code gen
        cli-login-store.ts            # NEW — Redis put/get/del wrapped around the existing connection
      server.ts                       # MODIFIED — register both new routes
    tests/
      unit/
        cli-login-crypto.test.ts      # NEW — round-trip a known-good keypair against the upstream CLI's Go test vectors
        cli-login-store.test.ts       # NEW — Redis mock, TTL, single-use DEL
      contract/
        cli-login.contract.test.ts    # NEW — wire-shape snapshot, both surfaces
  web/
    src/
      pages/
        CliLogin.tsx                  # NEW — /dashboard/cli/login page (auto-mint, code display, error state)
      components/
        SetupGate.tsx                 # EXISTING — pattern reused for the session-cookie gate
      lib/
        api.ts                        # MODIFIED — add cliLoginApi.mint(...)
      App.tsx                         # MODIFIED — register /dashboard/cli/login route
      pages/
        SettingsTokens.tsx            # MODIFIED — render a "cli" badge next to source='cli' rows
        Login.tsx                     # MODIFIED — honor ?next= same-origin relative param

packages/
  db/
    src/
      schema/
        identity.ts                   # MODIFIED — add `source: text` to `apiTokens` (nullable, default 'manual', constrained to 'manual'|'cli')
    migrations/
      0012_api_tokens_source.sql      # NEW — idempotent ADD COLUMN IF NOT EXISTS + CHECK constraint
  shared/
    src/
      mgmt-api-schemas.ts             # MODIFIED — add CliLoginResponse Zod schema for wire-shape validation
```

**Structure Decision**: Supastack monorepo, existing layout extended. Crypto goes in its own `cli-login-crypto.ts` service module (pure functions, easily testable in isolation) rather than in `packages/crypto/` because it's specific to this feature's wire contract — moving it to shared would tempt other features to misuse the ECDH-P256 / AES-GCM combo for unrelated purposes. The Redis store wrapper is similarly local to the api app rather than shared because the key namespace + payload shape is feature-specific.

The `/dashboard/cli/login` and `/login` page modifications stay in `apps/web/src/pages/`. The post-login bounce-with-`?next=` logic uses the existing session-cookie behavior (no new auth plugin work).

## Complexity Tracking

*No constitution gates to violate. No exceptions to justify.*
