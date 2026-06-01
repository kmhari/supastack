# Research: Postgres Public Endpoint via Top-Level Pooler

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23 (rewritten post-pivot)

---

## Decision 1: Routing Technology — Supavisor (Top-Level)

**Decision**: Add a single `supabase/supavisor:2.7.4` service to the supastack control plane. It owns the external `:5432` port, terminates TLS using the wildcard cert, extracts the tenant ref from SNI, and proxies to the per-instance Postgres backend with built-in connection pooling.

**Rationale**:
- Supavisor was designed by Supabase specifically for multi-tenant Postgres routing — it's the same component running Supabase Cloud's database-edge layer.
- Battle-tested: handles thousands of tenants at scale in production at Supabase.
- Built-in features we'd otherwise have to write: STARTTLS handshake (`'S'` response), TLS termination, SNI-based tenant lookup, per-tenant connection pooling (transaction + session modes), Prometheus metrics, tenant CRUD API, SCRAM-SHA-256 auth, encrypted password storage.
- Same Docker image we already use per-instance — zero new vendor risk; already in our image set.
- Architecture matches Supabase Cloud exactly → "self-host the real thing" parity.

**Alternatives considered and rejected**:
- **Caddy L4 (previous approach)** — caddy-l4's `postgres` matcher detects SSLRequest but doesn't write `'S'` response. Client never sends ClientHello → SNI never visible → routing impossible. Confirmed empirically on the VM (Caddy debug log showed `read:8, written:0` then connection close).
- **Custom Node.js TCP proxy (~100 lines)** — reimplements what supavisor already does; no pooling; no metrics; diverges from Cloud behavior. Faster to ship but creates technical debt forever.
- **HAProxy + Lua** — same custom-code burden as the Node.js path, in a less-familiar language (Lua), with worse debugging. No HAProxy-native primitive for Postgres STARTTLS dance.
- **pgcat / pgbouncer** — routing logic uses database name or username, not SNI subdomain. Doesn't fit our `db.<ref>.<apex>` hostname-as-tenant-key convention.

---

## Decision 2: Supavisor Metadata DB Location

**Decision**: Use the existing supastack control-plane Postgres (`db` service in `infra/docker-compose.yml`) as supavisor's metadata DB. Supavisor's Ecto migrations create tables in a `_supavisor` schema on first boot.

**Rationale**:
- No new database to provision, back up, or monitor.
- Supavisor's tenant CRUD becomes a same-host transaction (low latency).
- The control-plane DB is already protected by `pg-data` volume backups, `CONTROL_DB_PASSWORD` secret, and `MASTER_KEY` for any secrets we encrypt before passing to supavisor.
- Supastack's own tracking table (`pooler_tenants`) can JOIN against `_supavisor.tenants` if needed for debug/reconciliation.

**Alternatives considered**:
- Dedicated supavisor Postgres — extra container, extra backup story, no benefit for our scale.

**Connection string** (Supavisor's `DATABASE_URL`):
```
postgres://supastack:${CONTROL_DB_PASSWORD}@db:5432/supastack
```

---

## Decision 3: Tenant Lifecycle Ownership

**Decision**: Supastack's `api` owns tenant lifecycle. On project provision: api INSERTs `pooler_tenants` row + calls supavisor's HTTP API to register the tenant. On project destroy: api DELETEs + calls supavisor to unregister.

**Why HTTP API and not direct SQL into `_supavisor.tenants`**:
- Supavisor's Ecto schema has invariants (auth_query format, user role mapping, encrypted password handling) that we shouldn't bypass. Direct SQL would mean re-implementing supavisor's encryption.
- The supavisor admin HTTP API is the supported contract; surviving upgrades is easier this way.

**JWT auth for the admin API**: Supavisor expects `Authorization: Bearer <jwt>` signed with `API_JWT_SECRET` (HS256). The api mints a short-TTL JWT (5 min) per request — no JWT cache.

**Atomicity**: Tenant registration runs INSIDE the same database transaction that creates the `supabase_instances` row. On supavisor HTTP failure, the transaction rolls back the entire provision — operator never sees a half-created project. Supastack's `pooler_tenants` row carries `status='registering'` while the supavisor call is in flight; flipped to `'active'` only after success. The reconciler picks up `'registering'` rows older than 60s and either retries or marks `'failed'`.

---

## Decision 4: Network Topology for Per-Instance Backend Access

**Decision**: Supavisor connects to per-instance Postgres via `host.docker.internal:<published-port>`. Each per-instance compose stack publishes its db on a unique host port (`POSTGRES_DIRECT_HOST_PORT`, allocated from the existing port pool).

**Why not Docker network bridging**:
- Per-instance compose stacks run on isolated docker networks (`supastack-<ref>_default`). Supavisor would need to join each per-instance network — Docker doesn't easily support a container being on N dynamically-changing networks.
- `host.docker.internal` is already wired in supastack (Caddy uses it for per-instance Kong/Studio routing). Reusing this pattern keeps networking consistent.

**Why publishing per-instance db is safe**:
- The host port is on the VM's loopback / internal network. Not exposed externally unless the operator opens the firewall.
- Per-instance Postgres still enforces password auth — no anonymous access regardless.

**Port allocation**: Add `POSTGRES_DIRECT_HOST_PORT` to the port pool alongside existing `kong`, `studio`, `postgres` (supavisor transaction), `pooler` (supavisor session), `analytics`. One additional integer per instance.

---

## Decision 5: TLS Cert Distribution to Supavisor

**Decision**: Mount the shared `certs-data` Docker volume into supavisor as read-only at `/var/supastack/certs`. Supavisor's `SUPAVISOR_SSL_CERT` and `SUPAVISOR_SSL_KEY` env vars point at the file paths.

**Cert rotation**: When the wildcard cert renews (feature 004 daily cron), the cert files on the shared volume update in place. Supavisor needs to be signaled to reload. Two paths:
- **Auto** — supavisor 2.x supports SIGHUP for cert reload; the api sends SIGHUP after cert renewal succeeds
- **Restart** — `docker compose restart supavisor` (brief downtime, ~5s)

Preferred: SIGHUP via the api's existing cert-renewal flow. Fallback to restart if SIGHUP is unreliable.

---

## Decision 6: Supastack Tracking Table (`pooler_tenants`)

**Decision**: Keep a supastack-side `pooler_tenants` table separate from supavisor's `_supavisor.tenants`. Supastack owns its source-of-truth row; the reconciler reconciles between the two.

**Why two tables**:
- Supastack's `pooler_tenants` can carry supastack-specific state (last health check, retry counters, audit-friendly fields) without polluting supavisor's schema.
- If we ever migrate off supavisor (unlikely), our DB still has the canonical list of which instances have public Postgres endpoints.
- Reconciler logic compares the two and surfaces drift.

---

## Decision 7: Backfill for Existing Instances

**Decision**: One-shot `backfill-pooler-tenants.ts` script. Runs as part of deploy. For each row in `supabase_instances` not yet registered, decrypts the password and registers via the supavisor HTTP API. Idempotent — skips already-registered tenants.

**Why a script not an automatic on-startup migration**:
- Decryption requires `MASTER_KEY` which we don't want to run on every api startup more than necessary.
- Operator gets visible feedback: `✓ ref1`, `✓ ref2`, `✗ ref3 (error)`. Logs are easy to diff against expected count.
- Re-runnable safely if interrupted.

**Failure mode**: If the script can't register some instance (e.g., transient DB error), it logs and moves on. The reconciler picks up the gap on its next run.

---

## Decision 8: Reconciler Cadence and Drift Categories

**Decision**: Daily BullMQ cron at `0 3 * * *` (3 AM, 1 hour after cert-check). Detects four kinds of drift:

| Drift | Action |
|---|---|
| `pooler_tenants` row exists but no matching instance | Unregister from supavisor, DELETE row, log `reconcile orphan` |
| Instance exists, no `pooler_tenants` row | Register, INSERT row, log `reconcile missing` |
| `pooler_tenants` row + supavisor tenant + instance exist but password mismatch (e.g., operator rotated) | Update supavisor's stored password via HTTP API, log `reconcile rotate` |
| `pooler_tenants.status = 'registering'` for >60s | Re-attempt register, set `failed` if still erroring |

---

## Decision 9: Studio "Direct Connection" Display — Deferred

**Decision**: Defer Studio's "Direct connection" display fix to a follow-up. For v1 of this feature, Studio may still show `db:5432` (the internal hostname). The PRIMARY user value of this feature — `supabase db push` working without `--db-url` — works regardless of Studio display.

**Why deferred**:
- Studio reads `POSTGRES_HOST` for its display. Setting `POSTGRES_HOST=db.<ref>.<apex>` breaks sibling-container connections (we proved this empirically when supavisor crashed).
- Fixing properly requires either: (a) finding a Studio-specific env var that controls display independently, OR (b) patching the Studio image.
- Both are real work but orthogonal to the routing feature. Tracked separately so they don't block.

The dashboard's TLS/Database settings panel (built in this feature via `PoolerHealthCard.tsx`) WILL show the correct connection string — operators can copy from there until Studio is fixed.

---

## Decision 10: Caddy L4 Code — Removed (not just disabled)

**Decision**: Remove the `layer4` block from `apps/api/src/services/caddy-config.ts` entirely. Remove port `5432:5432` from the caddy service in `infra/docker-compose.yml`. Keep the custom Caddy Dockerfile + caddy-l4 module — they don't hurt and are useful for future raw-TCP needs.

**Why delete the layer4 emission code rather than disabling it**:
- Code that's "off but kept around" rots; future maintainers re-enable it and re-hit the STARTTLS limit.
- Removal is one revert; restoration (if ever needed) is one revert.
- Tests for `caddy-config.ts` need to be updated regardless — they currently assert layer4 IS emitted under certain conditions.

---

## Reference Implementation

- **Supavisor docs**: https://supabase.github.io/supavisor/ (API, tenant schema, env vars)
- **Existing per-instance config**: `infra/supabase-template/docker-compose.yml` (supavisor service) — same image, similar env, narrower role (single-tenant) — serves as a template for the top-level service config
- **Per-instance bootstrap**: `infra/supabase-template/volumes/pooler/pooler.exs` shows how a tenant is registered programmatically (Elixir API). The HTTP API mirrors these fields.
