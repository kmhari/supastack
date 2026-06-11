# Research — Feature 117 (Single-Source Apex)

All Technical Context items were resolved during the conversation that produced the spec + clarifications; no open `NEEDS CLARIFICATION` remained. Decisions recorded below.

## R1. Single source = env, accessed through one shared helper

**Decision**: `SUPASTACK_APEX` (env) is the single source. Add `packages/shared/src/apex.ts` exporting `getApex(): string | null` (reads `process.env.SUPASTACK_APEX ?? null`), `getApexOrThrow(): string` (throws if unset — for code paths that require it), and `isRealApex(apex): boolean` (`apex && apex !== 'localhost' && apex.includes('.')`). Every current reader of `installation.apexDomain` repoints to this helper.

**Rationale**: Both `apps/api` **and** `apps/worker` read the apex (`provision.ts`, `pooler-reconciler.ts`), so the accessor must live in `@supastack/shared`. One typed accessor (vs 20 scattered `process.env.SUPASTACK_APEX` reads) keeps the source greppable and gives the local-domain test a single seam. Reading env is strictly cheaper than the prior DB round-trip.

**Alternatives**: (a) keep the DB value as an env-seeded mirror — rejected at clarification (a second store can still drift; dropping it is cleaner). (b) 20 direct `process.env` reads — rejected (no single seam, harder to guard).

## R2. Drop the `installation.apex_domain` column (idempotent, destructive)

**Decision**: Migration `0024_drop_installation_apex_domain.sql` = `ALTER TABLE installation DROP COLUMN IF EXISTS apex_domain;` and remove `apexDomain` from the Drizzle `installation` schema. Removing the column also removes its `UNIQUE` constraint.

**Rationale**: Constitution I permits explicitly-intentional destructive changes; `DROP COLUMN IF EXISTS` is idempotent (re-run = no-op). No backfill: the authoritative value already lives in env. Eliminating the column makes #110 divergence structurally impossible.

**Critical dependency**: the **worker has no `SUPASTACK_APEX` env today** (compose sets it only on auth/api/mcp/supavisor/caddy/studio). The worker reads the apex in `provision.ts:63` + `pooler-reconciler.ts:225`, so the column drop **requires adding `SUPASTACK_APEX: ${SUPASTACK_APEX:?SUPASTACK_APEX required}` to the worker service** — otherwise those jobs read `undefined` post-migration.

**Alternatives**: keep the column nullable + unused — rejected (dead column + the misleading writes remain; #110 not actually closed).

## R3. `/setup` reads the env apex and skips the input

**Decision**: `GET /api/v1/apex` sources the apex from `getApex()` (was the DB). The wizard's `DomainCertsStep` already branches `initialApex ? 'verifying-dns' : 'enter-apex'`, so once `apexApi.status().apex` is env-backed (non-null on a configured install), the wizard lands on the DNS-records step automatically. Remove the `enter-apex` sub-state, the `apexInput` field, and the `orgApi.patch({apexDomain})` write.

**Rationale**: Reuses the wizard's existing skip path — minimal frontend change. The duplicate write was the #110 entry point; removing it (plus the column) leaves env as the only source.

## R4. Local/default domain blocks the DNS + cert step (clarification)

**Decision**: When `isRealApex(apex)` is false (e.g. `localhost`, empty, no dot), `/setup` blocks the DNS + certificate step with a "set a real domain at install (re-run the installer)" message; it does not attempt DNS-01/cert issuance and does not show a domain-entry field. The server exposes the determination (`/apex` includes the apex; the gate uses `isRealApex`) and the frontend renders the block.

**Rationale**: DNS-01 + a public wildcard cert are meaningless for `localhost`. Per the operator's clarification, the strict choice (block) is preferred over attempting a doomed issuance or silently proceeding. `localhost` stays valid for local/offline dev, just not completable through `/setup`.

## R5. Reliable installer domain capture

**Decision**: `install.sh` resolves the domain in priority order: positional `$1` → `SUPASTACK_APEX` env → existing `.env` value → interactive prompt **read from `/dev/tty`** → warned `localhost`. The `/dev/tty` read makes `curl … | bash` prompt (its stdin is the pipe, so the current `[[ -t 0 ]]` test fails and silently defaults). Persist the resolved value to the project `.env` (what compose reads), never to a shell rc.

**Rationale**: The common install path (`curl | bash`) currently skips the prompt and silently defaults to `localhost`. `/dev/tty` is the controlling terminal regardless of stdin, so the prompt fires either way. Factor the resolution order into a small pure function for a unit test (the ordering, not the I/O).

**Alternatives**: a standalone cert CLI / two-phase compose (Option 3) — out of scope; this feature keeps the boot model and only hardens capture + unifies the source.

## R6. Scope boundary (out of scope)

Apex-less boot, staged service activation, browser-chosen domain, and live domain change are **out of scope** (the heavier Option-2 path, deliberately not taken). Changing the domain remains a deliberate re-install.
