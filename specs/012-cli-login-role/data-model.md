# Data Model — CLI login-role

**Feature**: 012-cli-login-role
**Date**: 2026-05-25

## Storage summary

| Concern | Where | Persistence | Lifecycle |
|---|---|---|---|
| CLI login roles (rw + ro) | Per-project Postgres `pg_authid` | Permanent (until project deletion) | Created on first endpoint call per project + scope; rolpassword & rolvaliduntil rewritten every call |
| Rate-limit token bucket | api-container heap (`Map<string, BucketState>`) | Transient (process lifetime) | Created on first endpoint call per `(patId, projectRef)`; entry expired after 10 min idle |
| Audit events | pino structured log (stdout → operator's log pipeline) | Per operator's log retention | Emitted on every successful endpoint call |
| **Nothing else** | Control-plane Postgres | — | **No new control-plane table, no Drizzle migration** |

The notable absence of a control-plane DB row matches the spec's intent: source of truth lives where it must be enforced (per-project `pg_authid`), and the control plane stays stateless for this feature.

---

## Entity 1 — Persistent CLI auth role (per project, per scope)

Lives in the per-project Postgres only. Two instances per project, max.

### Schema

```sql
-- Equivalent to what the create endpoint runs idempotently per scope.
-- Read-write variant:
CREATE ROLE "cli_login_postgres"
  NOINHERIT
  LOGIN
  NOREPLICATION
  IN ROLE postgres;

-- Read-only variant:
CREATE ROLE "cli_login_supabase_read_only_user"
  NOINHERIT
  LOGIN
  NOREPLICATION
  IN ROLE supabase_read_only_user;
```

### Attributes (fields in `pg_authid`/`pg_roles`)

| Field | Type | Source | Notes |
|---|---|---|---|
| `rolname` | `name` | Deterministic — set at CREATE time | `cli_login_postgres` or `cli_login_supabase_read_only_user`. Constant per (project, scope). |
| `rolcanlogin` | `bool` | Deterministic — `true` | Required so SCRAM handshake succeeds. |
| `rolinherit` | `bool` | Deterministic — `false` (NOINHERIT) | Forces the CLI to run `SET SESSION ROLE` to obtain any privileges. Defense in depth. |
| `rolsuper` / `rolcreaterole` / `rolcreatedb` / `rolreplication` | `bool` | Deterministic — `false` | The role has no inherent privileges at rest. |
| `rolpassword` | `text` (SCRAM hash) | **Rewritten every endpoint call** | Source: `crypto.randomBytes(32).toString('hex')` — 256 bits of entropy, hex-encoded for SQL-safe interpolation. Postgres stores it as the SCRAM-SHA-256 verifier, not plaintext. |
| `rolvaliduntil` | `timestamptz` | **Rewritten every endpoint call** | Set to `now() + interval '5 minutes'` on every successful POST. Set to `'1970-01-01'` on DELETE. Postgres refuses authentication when `now() > rolvaliduntil`. |
| `pg_auth_members.member` | `oid` | Deterministic — set once at CREATE time | The role is a member of `postgres` (rw) or `supabase_read_only_user` (ro) — this is the `IN ROLE` clause. Enables `SET SESSION ROLE <target>` from the CLI's `AfterConnect` handler. |

### Validation rules (enforced by SQL, not application code)

- **Role name uniqueness**: enforced by `pg_authid_rolname_index` (Postgres native). The idempotent `IF NOT EXISTS … CREATE ROLE` block at the start of the endpoint's SQL is what makes the create step safe to call concurrently with itself.
- **Password validity**: `rolvaliduntil` is the only authentication-relevant timestamp. Postgres itself enforces refusal after expiry — no application-level check needed.
- **Scope ⇄ name mapping**: `read_only: false` → `cli_login_postgres`. `read_only: true` → `cli_login_supabase_read_only_user`. No other names are recognised.
- **Target role existence**: `IN ROLE postgres` requires `postgres` to exist (true on every Supabase PG image by default). `IN ROLE supabase_read_only_user` requires `supabase_read_only_user` to exist (true on every Supabase PG image — created in `migrations/db/init-scripts/00000000000000-initial-schema.sql:19`). If either is missing the endpoint returns a 500 — out-of-scope failure mode, indicates the PG image is malformed.

### State transitions

```text
                         ┌─────────────────────────┐
                         │ pg_authid row absent     │
                         │ (initial state)          │
                         └──────────┬──────────────┘
                                    │ first POST call
                                    ▼
                         ┌─────────────────────────┐
                         │ exists, no valid password│  ◄─── (transient — only between
                         │ rolpassword=NULL         │       CREATE and ALTER PASSWORD;
                         └──────────┬──────────────┘       guarded by single TX + advisory lock)
                                    │ ALTER ROLE ... WITH PASSWORD ... VALID UNTIL <now+5min>
                                    ▼
       (every POST)     ┌─────────────────────────┐
       ◀─ ─ ─ ─ ─ ─ ─ ─ │ authentication usable    │
                         │ rolvaliduntil = future   │  ◄─── steady state during a CLI command
                         └──────────┬──────────────┘
                                    │  now() > rolvaliduntil  OR  DELETE call
                                    ▼
                         ┌─────────────────────────┐
                         │ authentication refused   │
                         │ but role+membership      │
                         │ still present            │  ◄─── steady state between CLI commands
                         └──────────┬──────────────┘
                                    │ next POST call
                                    ▼
                            (back to "usable")
```

There is no DROP transition during normal operation. The only DROP path is via project deletion (the entire per-project PG cluster goes with it).

### Relationships

- **Role membership**: each CLI role is a member of exactly one target role (`postgres` or `supabase_read_only_user`) via the `IN ROLE` clause. The target role itself is supastack-managed (created by the upstream PG image's init scripts) and is unchanged by this feature.
- **No relationship to control-plane entities**: the api container does NOT store a foreign key from any control-plane table to these roles. Knowledge that they exist comes only from the SQL idempotency check at endpoint-call time.

---

## Entity 2 — Rate-limit token bucket (per PAT, per project)

Lives in api-container heap. Lost on container restart (acceptable — restart is rare and a fresh bucket simply gives the next batch of legit calls a free 30/min window).

### Schema (TypeScript)

```ts
// In apps/api/src/services/cli-login-role-service.ts
interface BucketState {
  count: number;      // calls observed in the current window
  windowStart: number; // ms since epoch when the current window opened
}

const RATE_LIMIT_BUCKET = new Map<string, BucketState>();
const LIMIT = 30;
const WINDOW_MS = 60_000;
const IDLE_EVICTION_MS = 10 * 60_000;
```

### Key

`${patId}:${projectRef}` — e.g., `7b3a1c4d-…:aaaabbbbccccdddd eeee`.

PAT id (not IP) because PAT identity is the rate-limit subject (spec Q3).

### Attributes

| Field | Type | Source |
|---|---|---|
| `count` | `number` | Incremented on each `tryConsume(key)` call inside the active window |
| `windowStart` | `number` (epoch ms) | Set on first call; reset whenever `now - windowStart >= WINDOW_MS` |

### Operations

- `tryConsume(key) → boolean` — returns `true` if the request is allowed (incrementing `count`); returns `false` if the key has already reached LIMIT in the current window.
- **Lazy eviction**: on any `tryConsume`, opportunistically evict entries whose `windowStart < now - IDLE_EVICTION_MS`. No background sweeper. Bounded memory: at most ~ (PATs × active-projects) entries, expected ≪1000 on a real supastack deployment.

### Concurrency

- The `Map` operations under a single Node event loop are atomic (no parallelism within one process). No explicit lock needed.
- If supastack ever scales to multiple api replicas, this swaps for a Redis token bucket using `INCR + EXPIRE` — same interface. Out of scope for this feature.

### Validation

None at this layer — the rate-limit check rejects HTTP requests with 429 before reaching the service; the service-layer code path doesn't see throttled requests at all.

---

## Entity 3 — Audit log event

Emitted via Fastify's request-scoped pino logger. NOT persisted to a control-plane DB.

### Shape — successful POST

```json
{
  "level": 30,
  "time": 1748171234567,
  "event": "cli_login_role_rotated",
  "pat_id": "7b3a1c4d-2e8f-4a9c-9876-1234abcd5678",
  "project_ref": "aaaabbbbccccddddeeee",
  "scope": "read_write",
  "requester_ip": "203.0.113.42",
  "role": "cli_login_postgres",
  "msg": "cli login role rotated"
}
```

### Shape — successful DELETE

```json
{
  "level": 30,
  "time": 1748171289101,
  "event": "cli_login_role_invalidated",
  "pat_id": "7b3a1c4d-2e8f-4a9c-9876-1234abcd5678",
  "project_ref": "aaaabbbbccccddddeeee",
  "requester_ip": "203.0.113.42",
  "msg": "cli login roles invalidated"
}
```

### Operator query patterns

- "Show me every CLI auth touched today" — grep on `event=cli_login_role_rotated OR event=cli_login_role_invalidated`.
- "Who rotated this project's CLI password" — filter by `project_ref` field.
- "Did this PAT do anything weird in the last hour" — filter by `pat_id` + time window.

### Validation

- The log emission MUST NOT block the HTTP response — pino's async transport is the default and is non-blocking.
- The log entry MUST NOT contain the rotated password or any other secret — schema above contains only metadata.

---

## Things explicitly NOT modelled

- **No record of historical password values**. Once rotated, the previous value is gone from `pg_authid` and the api container's memory. This is intentional — leaking historical credentials is the entire failure mode this feature exists to prevent.
- **No control-plane FK from a project row to "has CLI roles provisioned"**. The endpoint's first call provisions the roles idempotently; we don't pre-create them at project-provision time. (Could be a future optimisation; out of scope.)
- **No PAT-level usage counter** beyond the rate-limit window. If/when we need a "show me my recent CLI activity" dashboard we'll add it; not now.
