# Quickstart — verify feature 087 (DNS-readiness gate, fix #94)

The fix is two small changes: (a) backend `allDnsReady` empty-guard, (b) frontend gate consumes `allTxtReady` + dead-code/lint removal. Verify by unit tests + a fresh-install wizard run.

## 1. Backend signal guard (SC-002)

```bash
pnpm exec vitest run apps/api/tests/unit  # the new allDnsReady-guard test
```
- empty `dnsChecks` → `allDnsReady === false` (NOT vacuously true)
- some unfound → `false`; non-empty + all found → `true`

## 2. Frontend gate logic (SC-001, SC-005)

```bash
pnpm exec vitest run apps/web/tests/unit  # the new gate test
pnpm --filter @supastack/web build         # green
```
- gate closed when `allDnsReady` is `false`/`undefined`/absent, even with apex+wildcard A ok
- gate open only when `apexDnsOk && wildcardDnsOk && allDnsReady === true`

## 3. Lint / dead-code (SC-004 / US2)

```bash
pnpm lint
grep -n "allTxtFound\|eslint-disable\|TODO(#94)" apps/web/src/pages/Setup.tsx   # → no matches
```
- 0 unused-variable errors in the wizard; no `eslint-disable` for this gate; `#94` TODO gone

## 4. Live fresh-install wizard (SC-001, SC-002, SC-003) — operator-run on a throwaway domain

Pre-DNS:
- Open `/setup`, reach step 2 before publishing TXT records → "Create Certs" stays **disabled** ("Waiting for DNS…"). (SC-002: never opens with no records.)

Publish + propagate:
- Add apex A, wildcard A, and the `_acme-challenge` TXT records → within one poll cycle the button **enables** with no manual workaround. (SC-001.)

Challenge-refresh regression (SC-003):
- Trigger a challenge re-issue mid-session (new TXT values) → the gate tracks the **current** records: it does not stay permanently stuck on "Waiting for DNS…"; publishing the new records enables the button. (This is the staleness bug #94 fixed.)

Negative-cache tolerance (edge case):
- Immediately after publishing, a resolver may briefly still report not-found; the gate shows "waiting" a little longer then self-heals on a later poll — acceptable, and no browser-side DNS lookup was added (FR-007).

## Success mapping

| SC | Verified by |
|---|---|
| SC-001 enable within one poll | §2 unit + §4 live |
| SC-002 never vacuously ready | §1 unit + §4 pre-DNS |
| SC-003 no permanent stuck on refresh | §4 challenge-refresh |
| SC-004 0 lint/eslint-disable, TODO gone | §3 |
| SC-005 A-record + HTTPS-probe unchanged | §2 (A-record terms untouched) + no api status-shape change |
