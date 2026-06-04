# Research — DNS-readiness gate (feature 087, fix #94)

No NEEDS CLARIFICATION remained from the spec. Three design decisions resolved below; all confirmed against the live code.

## D1 — Where does the empty-list guard live (FR-002)?

**Decision**: in the **backend**, at the signal source — `allDnsReady = dnsChecks.length > 0 && dnsChecks.every(c => c.found)`.

**Why**: `Array.prototype.every()` returns `true` for an empty array, so today `allDnsReady` is **vacuously `true`** whenever `challengeRecords` is empty (no challenge issued yet) — `routes/wildcard-certs.ts:81` and `services/acme.ts:189` both compute it this way. Guarding at the source makes `allDnsReady` authoritative and correct for **every** consumer (the wizard, the dashboard cert panel, any future caller), rather than pushing a `&& records.length > 0` correctness obligation onto each consumer. This is the spirit of Option A: the wizard should *trust* the backend boolean, which means the backend boolean must be right. Both call sites get the guard so they can't drift (cf. the queue-name single-source lesson).

**Alternatives considered**:
- *Frontend-only guard* (`allTxtReady && challengeRecords.length > 0` in the gate): rejected — re-creates the "consumer re-aggregates a server decision" anti-pattern this feature is removing, and leaves the backend signal still able to report a false `true` to other consumers.
- *Treat empty as `undefined`*: rejected — `allDnsReady` is already `boolean | undefined` (undefined while no order exists); the empty-but-order-exists case is a real `false`, not absence.

## D2 — Challenge re-issued/refreshed mid-session (FR-003)

**Decision**: rely on the backend recomputing per poll from the **current** `challengeRecords`; the wizard reads only `cert.allDnsReady`, never a captured-once list.

**Why**: `GET /wildcard-certs/status` reads `row.challengeRecords` fresh and runs `checkDns()` on every call (`wildcard-certs.ts:79-81`), so a refreshed challenge is reflected on the next poll automatically. The staleness bug in #94 comes purely from the **frontend** `allTxtFound` recount looping over its own frozen, captured-once expected-records list (`Setup.tsx:227`). Deleting that recount and consuming `allTxtReady` removes the only stale source — no extra refresh logic needed.

## D3 — Fail-safe when the signal is absent or errors (FR-006)

**Decision**: the gate stays **closed** by default; `allTxtReady` is `useState(false)` and is set from `wcStatus.cert?.allDnsReady ?? false` (`Setup.tsx:220,263,292`), so a missing/`undefined`/null `cert`, a transient status error, or `allDnsReady === undefined` all resolve to `false` → button disabled. No code path opens the gate without an explicit backend `true`.

## Out of scope (recorded follow-up)

Upgrading the backend pre-check from recursive public resolvers to **authoritative nameservers** (which would sidestep resolver negative-cache windows entirely) is a separate hardening, not part of #94. The fix must NOT add any browser-side DNS/apex lookup (FR-007) — that would risk caching a negative result on the operator's own resolver (the negative-TTL trap discussed during specify).

## Confirmed code anchors

| What | Location |
|---|---|
| Backend signal (to guard) | `apps/api/src/routes/wildcard-certs.ts:81`, `apps/api/src/services/acme.ts:189` |
| Status response shape | `wildcard-certs.ts:92-97` → `{ cert: { challengeRecords, dnsChecks, allDnsReady } }` |
| Wizard captures signal (unused) | `apps/web/src/pages/Setup.tsx:220,263,292` (`allTxtReady`) |
| Brittle recount (to delete) | `Setup.tsx:227` (`allTxtFound`) |
| The gate (to repoint) | `Setup.tsx:230` (`allDnsResolved = apexDnsOk && wildcardDnsOk && allTxtFound`) |
| TODO + eslint-disable (to delete) | `Setup.tsx:217-219` |
| Client API type (already has field) | `apps/web/src/lib/api.ts:91,116` (`allDnsReady?: boolean`) |
