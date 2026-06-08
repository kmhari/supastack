# 087 — Setup wizard DNS-readiness gate uses the authoritative signal (fix #94)

Spec: [specs/087-setup-dns-readiness-gate/spec.md](../../specs/087-setup-dns-readiness-gate/spec.md) ·
Plan: [specs/087-setup-dns-readiness-gate/plan.md](../../specs/087-setup-dns-readiness-gate/plan.md)

## The bug (#94)

The `/setup` wizard's "Create Certs" gate keyed off a **brittle, captured-once client-side recount** (`allTxtFound`) of per-record DNS results, while the backend's **authoritative** signal (`cert.allDnsReady`, from public-resolver lookups) was already fetched into `allTxtReady` — but never read (silenced with an `eslint-disable` + `TODO(#94)`). The client recount could go **stale** if the DNS-01 challenge was re-issued mid-session, leaving the gate stuck on "Waiting for DNS…" even after DNS was ready.

Separately, the backend signal had a latent correctness bug: `allDnsReady = dnsChecks.every(c => c.found)` is **vacuously `true` for an empty `challengeRecords`** (`[].every() === true`), so it could report "ready" when no challenge records existed.

## The fix (Option A)

- **Backend — single authoritative signal with the empty-guard.** New pure helper `computeAllDnsReady(dnsChecks)` in `apps/api/src/services/acme.ts`:
  ```ts
  dnsChecks.length > 0 && dnsChecks.every((c) => c.found)
  ```
  Both consumers use it — the status route (`routes/wildcard-certs.ts`) and `verifyAndFinalize` (`acme.ts`) — so the rule can't drift. (FR-002.)
- **Frontend — gate consumes the signal.** `apps/web/src/pages/Setup.tsx` now gates on `dnsGateReady(apexDnsOk, wildcardDnsOk, allTxtReady)` (new pure helper `apps/web/src/lib/dns-gate.ts`), where `allTxtReady = cert.allDnsReady ?? false` (fail-safe: undefined → closed, FR-006). The apex/wildcard A-record terms are unchanged (FR-004).
- **Cleanup (US2).** Removed the brittle `allTxtFound` recount and the `TODO(#94)` + `eslint-disable`.

Challenge-refresh (the #94 staleness) is fixed for free: the backend recomputes `allDnsReady` per poll from the *current* `challengeRecords`; deleting the frozen client list removes the only stale source. No new dependency, no migration, no new endpoint, **no browser-side DNS lookup** (FR-007).

## Files

| File | Change |
|---|---|
| `apps/api/src/services/acme.ts` | + `computeAllDnsReady` helper; use it (was `every(...)`) |
| `apps/api/src/routes/wildcard-certs.ts` | use `computeAllDnsReady` for the status signal |
| `apps/web/src/lib/dns-gate.ts` | new — `dnsGateReady` pure predicate |
| `apps/web/src/pages/Setup.tsx` | gate uses `dnsGateReady(...,allTxtReady)`; removed `allTxtFound` + TODO/eslint-disable |
| `apps/api/tests/unit/dns-ready-signal.test.ts` | new — empty→false, partial→false, all→true |
| `apps/web/tests/unit/dns-gate.test.ts` | new — gate open/closed combos |

## Verify

- `pnpm exec vitest run dns-ready-signal dns-gate` → 6 pass; `pnpm --filter @supastack/web build` + `test` green; `pnpm lint` clean; `grep -nE "allTxtFound|TODO\(#94\)|eslint-disable" apps/web/src/pages/Setup.tsx` → none.
- Live (operator, throwaway domain): pre-DNS → button disabled; publish records → enables within one poll; re-issue challenge mid-session → not permanently stuck.

## Deploy

Rebuild `api` (signal) + `web` (gate). No migration, no env change. Frontend change is baked into the `web` Vite build — `docker compose build web && up -d web`.
