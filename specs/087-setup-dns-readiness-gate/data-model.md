# Data Model — feature 087

**No persistent entities, no migration.** This feature changes a derived boolean and a UI gate condition; it reads existing state only.

## Derived values (not stored)

### `allDnsReady` (backend, authoritative)

- **Source**: `dnsChecks = await checkDns(challengeRecords)` (public DNS resolvers) in `routes/wildcard-certs.ts` + `services/acme.ts`.
- **Type**: `boolean | undefined` (undefined while no DNS-01 order/challenge exists).
- **Rule (corrected)**: `allDnsReady = dnsChecks.length > 0 && dnsChecks.every(c => c.found)`.
  - Empty `challengeRecords` ⇒ `dnsChecks = []` ⇒ **`false`** (was vacuously `true` — the #94 / FR-002 bug).
  - All records resolved by public resolvers ⇒ `true`.
  - Any record not yet found ⇒ `false`.

### The gate — `allDnsResolved` (frontend, `Setup.tsx`)

- **Rule**: `allDnsResolved = apexDnsOk && wildcardDnsOk && (cert.allDnsReady ?? false)`.
  - `apexDnsOk`, `wildcardDnsOk`: server-side A-record resolution flags — **unchanged** (FR-004).
  - Third term: now the authoritative `allDnsReady` (was the brittle `allTxtFound` recount — removed).
  - Defaults to `false` (gate closed) on any missing/error signal (FR-006).
- **Removed state**: `allTxtFound` (recount), and `allTxtReady` is repointed into the gate (no longer dead). The `TODO(#94)` + `eslint-disable` for the unused variable are deleted (US2).

## Read-only inputs (unchanged)

- `wildcard_certs.challengeRecords` (jsonb) — the `_acme-challenge` TXT records for the current order.
- apex / wildcard A-record resolution (existing server-side checks feeding `apexDnsOk` / `wildcardDnsOk`).
