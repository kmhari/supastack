# Phase 0 — Research

Open questions and decisions made during plan construction. Each item carries a Decision / Rationale / Alternatives shape so reviewers can challenge specific picks without re-doing the analysis.

## 1. Per-subdomain TLS strategy

**Decision**: Caddy 2 with on-demand TLS + an internal `GET /internal/tls/ask?domain=<host>` endpoint. Each instance subdomain receives its own HTTP-01-issued certificate on first request. No wildcards.

**Rationale**:
- Proven pattern in `/Users/lord/Code/open-frontend` (`apps/api/src/tls-ask/route.ts` + `apps/edge/src/reload.ts`). No new R&D.
- HTTP-01 needs no DNS provider integration — works against any DNS host as long as the apex A/CNAME is correct.
- Issuance is lazy: instance subdomains created but never accessed cost zero certificate work.

**Alternatives considered**:
- **Wildcard DNS-01 (`*.<apex>`)**: requires a DNS provider API key (Cloudflare token etc.) and a manual TXT-record dance per apex. Out for v1.
- **One cert per request via Caddy without gating**: open to abuse — anyone hitting random subdomains could exhaust the ACME order rate limit. The `tls-ask` gate prevents this.

## 2. Studio embedding with a non-root basePath

**Decision**: Build a single Studio image at supastack install time with `NEXT_PUBLIC_BASE_PATH=/studio`. Every instance's Compose stack references the same image. Each instance serves Studio at `https://<ref>.<apex>/studio` via its own Studio container.

**Rationale**:
- Confirmed by reading `supabase/supabase` `apps/studio/next.config.ts`: `basePath: process.env.NEXT_PUBLIC_BASE_PATH`. Next.js consumes `basePath` at build time only.
- Because each instance has its own subdomain, the path part is *constant* (`/studio`). One image is sufficient for all instances — no per-instance image build.
- Avoids per-instance image bloat (would have been ~150 MB × 15 instances = 2+ GB).

**Alternatives considered**:
- **Per-instance Studio image build with `NEXT_PUBLIC_BASE_PATH=/p/<ref>/studio`**: 2–3 min build per `create`, image storage explosion.
- **Reverse-proxy HTML/JS rewriting**: brittle, breaks on every Studio release.
- **Iframe a per-instance Studio subdomain (`studio.<ref>.<apex>`)**: doubles cert + route count per instance.
- **Rebuild table editor / SQL UI ourselves**: multi-week build; deferred to v1.5+.

## 3. Identifier scheme for instances

**Decision**: Generate a 20-character lowercase alphanumeric `ref` (CSPRNG) per instance, immutable. Display name (`name`) is separately editable. `ref` drives the subdomain and the Docker Compose project name; `name` is human-only.

**Rationale**:
- Matches Supabase Cloud's pattern (verified from their docs: `https://<project_ref>.supabase.co`).
- Renames never break URLs, connection strings, or audit trails.
- 20 lowercase alphanumerics give 36²⁰ space — collision-free in practice; we still UNIQUE the column.

**Alternatives considered**:
- **User-chosen slug**: forces users to invent unique identifiers; renames either break URLs or require URL rewrite history.
- **UUID v4**: works but ugly in URLs and longer than necessary.

## 4. Port allocation strategy

**Decision**: Dedicated `port_allocations` table with `port int PRIMARY KEY`. New-instance worker inserts five rows (Kong, Studio, Postgres, Pooler, Analytics) inside a single transaction over a configurable range (default `30000–39999`). On unique-constraint conflict, the transaction aborts and the worker retries with the next free batch.

**Rationale**:
- DB-tracked uniqueness eliminates the SupaConsole / Multibase failure mode (`Date.now() % N` + no listener check).
- Transactional insert is atomic — no TOCTOU window between "find free port" and "claim it".
- Range is configurable so operators with port conflicts (e.g., existing k8s on the host) can move it.

**Alternatives considered**:
- **Pick port + `psutil.net_connections()` check (Multibase pattern)**: race between check and allocation.
- **Allocate from a Redis counter**: works but adds a second source of truth.

## 5. JWT signing and key material

**Decision**: Use `jsonwebtoken` with `HS256` and the per-instance `JWT_SECRET` (40 random bytes, base64). Compute `anon_key` and `service_role_key` as real signed JWTs with payload `{ role, iss: "supabase", iat, exp: iat + 5 * 365 * 86400 }`. Verify in unit test that each generated key validates against the same secret.

**Rationale**:
- Supabase's GoTrue, Kong, and PostgREST all validate Bearer tokens by re-signing with `JWT_SECRET` and comparing — fake signatures (SupaConsole) silently fail downstream.
- HS256 matches upstream's defaults.

**Alternatives considered**:
- **RS256**: requires per-instance key pair management; HS256 is what upstream Supabase docker ships with.
- **Roll our own JWT**: pointless and dangerous — `jsonwebtoken` is mature and audited.

## 6. Secret encryption at rest

**Decision**: AES-256-GCM via Node's built-in `crypto`. Single 32-byte KEK from `MASTER_KEY` env (hex- or base64-decoded). Each `supabase_instances.encrypted_secrets` row is `iv || ciphertext || tag` (concatenated bytea). Plaintext is a JSON blob containing all per-instance secrets. SMTP password (the only other long-lived secret) is encrypted separately in its own column for granular access. Server refuses to start if `MASTER_KEY` is missing/invalid (SC-011).

**Rationale**:
- AES-GCM is authenticated and well-supported in Node core (no dependency, no native build).
- Single KEK avoids key-management complexity in v1; future revision can introduce per-instance DEKs (envelope encryption) without changing the surface (interface stays put → bytea in/out).
- Refuse-to-start guards against ops mistakes (operator forgets to set env var on restart).

**Alternatives considered**:
- **Plaintext in DB**: rejected during interview (FR-011, SC-011).
- **External KMS (Vault, AWS KMS, Infisical)**: future option; over-engineered for v1.
- **Threshold cryptography (age k-of-n)**: deferred to v2+.

## 7. Backup storage abstraction

**Decision**: `BackupStore` interface in `packages/backup-store` with `put`, `get`, `list`, `delete`. Implementations: `LocalDiskStore({ root: '/var/supastack/backups' })` and `S3Store({ endpoint, bucket, region, accessKeyId, secretAccessKey })`. The `endpoint` parameter lets `S3Store` target S3-compatible services (MinIO, Cloudflare R2, Backblaze B2). Org-level config picks one impl.

**Rationale**:
- Lets v1 ship local-disk for solo operators and S3 for those who care, without two API code paths.
- Interface is small and stable; new impls (Azure Blob, GCS) can land later without touching call sites.

**Alternatives considered**:
- **Local only in v1**: rejected during interview — pluggable was preferred.
- **Use S3 always, treat local as MinIO**: extra running component for solo ops.

## 8. Backup mechanism (`pg_dump`)

**Decision**: For each backup job, run `docker exec supastack-<ref>-db pg_dump -U postgres -Fc postgres` and stream stdout directly into the chosen `BackupStore.put()`. Format is custom (`-Fc`) — gives compression + selective restore + `pg_restore --list` introspection. The instance must be `running` (or temporarily resumed) — implementation transitions the state cleanly when needed.

**Rationale**:
- Custom format is the standard idiom; restorable with `pg_restore`.
- Streaming avoids buffering large dumps to memory or temp disk.

**Alternatives considered**:
- **Physical (`pg_basebackup`)**: needed for PITR (out of v1 scope) and ties us to specific Postgres versions.
- **Logical SQL dump (`-Fp`)**: bigger files, no introspection.

## 9. Daily backup scheduler

**Decision**: BullMQ repeatable job firing hourly. On each tick, query for instances with `backup_auto_enabled = true` whose latest successful backup is `> 24h` old, and enqueue a `backup` job for each. Retention enforcement runs immediately after a successful backup, deleting the (N+1)th-oldest and beyond from both the store and the DB.

**Rationale**:
- Hourly tick + lateness check is robust to worker downtime (catches up).
- Retention runs with each successful new backup → invariant easy to test (SC-007).
- BullMQ's repeatable-job pattern is battle-tested.

**Alternatives considered**:
- **Cron-style "exactly at 03:00"**: more precise, but missed runs require operator intervention.
- **Per-instance cron expression**: deferred — adds UI surface and validation work for marginal benefit.

## 10. Caddy reload mechanism

**Decision**: Atomic `POST http://caddy:2019/load` with the full Caddy JSON config produced by `caddy-config.ts`. Triggered from a debounced (200 ms) BullMQ job whenever an instance's status or apex configuration changes. The static `Caddyfile` mounted into the container at start only defines `{ admin :2019; on_demand_tls { ask <api>/internal/tls/ask } }` and the HTTPS→HTTP redirect; every per-instance server block is added through `/load`.

**Rationale**:
- Atomic swap matches `open-frontend`'s pattern; no partial-update races.
- Debouncing coalesces churn during e.g. bulk-pause operations.

**Alternatives considered**:
- **Partial PATCH to specific Caddy config paths**: works but stateful and harder to reason about.
- **Restart the Caddy container**: drops in-flight connections.

## 11. Internal `tls-ask` shape

**Decision**: `GET /internal/tls/ask?domain=<host>` is exposed only on the API container's internal network (Docker network isolation). Returns 200 if the host matches the configured apex OR a `<ref>.<apex>` pattern where the instance exists and is not deleted; otherwise 404. No body required.

**Rationale**:
- Caddy expects 200/non-200 — body is irrelevant.
- Restricting to the internal network removes auth complexity.

**Alternatives considered**:
- **Auth via a shared secret in the URL**: not needed if network is isolated; extra rotation surface.

## 12. Vendoring the upstream Supabase docker template

**Decision**: Vendor `supabase/supabase` `docker/*` (Compose file, kong.yml, vector.yml, init SQL files, `.env.example`) at a pinned commit under `infra/supabase-template/`. Pin to the latest stable Supabase release at start of implementation (Supabase tags monthly). Document the upgrade procedure in a top-level `UPGRADING.md`.

**Rationale**:
- Self-contained: no fetch at instance-create time, deterministic builds.
- `.env.example` becomes the source of truth for "every variable upstream's compose references", eliminating the Multibase missing-variables failure (the `huntvox` bug we observed).
- Pinning gives us a stable reference point; operators upgrade via per-instance `version` setting once we ship multi-version support.

**Alternatives considered**:
- **Clone upstream at install time (SupaConsole pattern)**: pins behaviour to whatever HEAD looked like at install, hard to upgrade.
- **Generate compose from scratch**: Multibase did this — 55 KB of inline templates, every Supabase upgrade breaks something.

## 13. Studio image build (supastack install step)

**Decision**: `infra/studio/Dockerfile` extends the upstream Supabase Studio source at the same pinned commit and bakes in `NEXT_PUBLIC_BASE_PATH=/studio` at build time. `install.sh` builds this image once during setup (`docker build -t supastack/studio:<commit>`). The per-instance `docker-compose.yml` references `supastack/studio:<commit>` instead of `supabase/studio:<tag>`.

**Rationale**:
- One-time cost during install (~3 min). Per-instance creates only pull the prebuilt local image.
- Pinning to the same upstream commit as the rest of the template avoids version drift.

**Alternatives considered**:
- See item 2.

## 14. Argon2id parameters

**Decision**: Use OWASP-recommended Argon2id parameters for interactive web logins: `memoryCost=19456` (19 MiB), `timeCost=2`, `parallelism=1`, `hashLength=32`, `saltLength=16`.

**Rationale**:
- Current OWASP recommendation for Argon2id (as of 2025).
- Fast enough for interactive login (~100 ms on modest hardware), memory-hard enough to defeat GPU attacks.

**Alternatives considered**:
- **bcrypt**: weaker, no memory cost; mature but less defended against GPU/ASIC.
- **scrypt**: comparable security; argon2 is the modern recommendation and used by open-frontend (consistency).

## 15. Session vs. Bearer tokens

**Decision**: `@fastify/session` with Redis store for browser users; SHA256-hashed Bearer tokens in `api_tokens` table for programmatic access. Token labels are user-supplied (e.g., "ci pipeline"); `last_used_at` updated on each use. Revoke = delete row. Removing a user invalidates their tokens AND active sessions (cascade by user-id index lookup on the session store).

**Rationale**:
- Mirrors open-frontend's pattern; well-trodden code.
- SHA256 in DB means a leaked DB doesn't compromise live tokens (the row stores a hash; the token is only ever shown at creation).

**Alternatives considered**:
- **JWT-based auth tokens**: stateless but revocation requires deny-lists; we want hard revocation on user removal (FR-031).

## 16. Per-instance `.env` generation rules

**Decision**: `packages/docker-control/src/compose-template.ts` accepts the upstream `.env.example` (vendored), runs a strict templater that:
1. Parses every `${VAR}` reference in the Compose file AND in any included resource (`kong.yml`, vector config, init SQL).
2. Asserts that every referenced var has a value provided by the caller OR an explicit empty-string default — fails loudly on missing.
3. Emits the final `.env` with **every** variable set (empty-string for opt-outs).

Generated values are passed via a typed struct, not by string substitution.

**Rationale**:
- Eliminates the Multibase failure: dashboard-created instances had `.env` files with ~20 missing variables that the upstream compose silently defaults to empty (which then breaks subtle things like analytics + auth callbacks). Forcing every variable to be present (even empty) makes the failure mode explicit.

**Alternatives considered**:
- **`docker compose config` against partial .env**: doesn't catch unreferenced vars and accepts empty-string substitution.

## 17. Password and identifier safety

**Decision**: Generated passwords use the charset `[A-Za-z0-9]` only — explicitly no `$`. `ref` uses `[a-z0-9]` only. Unit test that 1000 random samples of each contain no forbidden characters. Generated values are written to `.env` *unquoted* (compose-safe), then verified via `docker compose config` to round-trip without substitution.

**Rationale**:
- Multibase's `huntvox/.env` produced `POSTGRES_PASSWORD=...$GINIWZBA8` which Docker Compose interpreted as `${GINIWZBA8}` and substituted to empty string. Forbidding `$` end-to-end avoids the entire class.

**Alternatives considered**:
- **Quote the value in `.env`**: still fragile across compose versions; charset restriction is hermetic.

## 18. Failure-mode and observability defaults

**Decision**:
- Pino structured JSON logging at INFO by default; DEBUG when `LOG_LEVEL=debug`.
- BullMQ failed jobs retained (no auto-remove on fail) so the dashboard can surface them.
- `supabase_instances.status = 'failed'` rows are NOT auto-cleaned — operator inspects + deletes.
- `audit_log` table records every destructive action and every secret reveal, attributed to the acting user.

**Rationale**:
- Aligns with FR-032, FR-034, SC-008, SC-009.
- Supastack is operator-administered; auditability matters more than tidiness.

## 19. Testing strategy summary

**Decision**:
- **Unit (Vitest)** in every package. Mandatory coverage of: crypto round-trips (encrypt→decrypt, sign→verify), port allocator under contention, RBAC `(role × action)` matrix, BackupStore impls against fixtures.
- **Contract**: per-route Vitest tests under `apps/api/tests/contract/` that issue HTTP calls with admin and member tokens and assert the authorization matrix from `spec.md` Acceptance Scenario sets.
- **Integration**: a Docker-Compose-based suite that boots supastack and provisions a single managed instance, then makes real REST calls with the generated `anon_key`. Runs in CI on tagged PRs and on a nightly job. Smoke target: SC-001, SC-003.
- **E2E (Playwright)**: golden-path through setup → create → reveal credentials → pause → resume → backup → delete. Smoke target: SC-005, SC-009.

**Rationale**:
- Contract tests prevent regressions in the authorization surface (most likely to silently degrade).
- Integration tests catch issues that unit tests cannot (real Docker, real Caddy, real cert issuance — the latter against a local CA in CI).

## 20. Open assumptions explicitly carried forward

- We assume Caddy 2.8+ (for the current on-demand TLS gating shape).
- We assume Node 20 LTS for the duration of v1.
- We assume operators run on Ubuntu 22.04/24.04 (kernel features for Docker rootful daemon).
- Email delivery for invites: in v1 we surface the invite link in the dashboard *and* attempt SMTP if the org has SMTP configured. No mandatory SMTP for invites — keeps solo operator unblocked.

---

All `NEEDS CLARIFICATION` markers in the original `plan-template.md` have been resolved by the decisions above.
