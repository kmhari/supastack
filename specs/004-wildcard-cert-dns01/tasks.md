# Tasks: Wildcard TLS Cert via DNS-01

**Input**: Design documents from `specs/004-wildcard-cert-dns01/`

**Feature**: Manual DNS-01 wildcard cert via `acme-client` npm + Caddy `tls.certificates.load_files`

**Reference implementation**: `open-frontend/apps/api/src/services/acme-manual.ts` + `open-frontend/apps/edge/src/reload.ts`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency conflicts)
- **[US1]**: Wildcard cert issuance during /setup wizard
- **[US2]**: VM reset + re-setup verification + renewal alert

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add `certs-data` volume, install `acme-client` dep. Unblocks all subsequent work.

- [ ] T001 Add `certs-data` Docker volume to `infra/docker-compose.yml` — declare volume under `volumes:`, mount read-write at `/var/selfbase/certs` in `api` service, mount read-only at `/var/selfbase/certs` in `caddy` service, add `SELFBASE_CERTS_DIR: /var/selfbase/certs` env to `api` service
- [ ] T002 [P] Add `acme-client` npm dependency to `apps/api/package.json` and run `pnpm install` from repo root

**Checkpoint**: Caddy still starts (`docker compose up caddy`), api container has `/var/selfbase/certs` mount.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DB schema + Drizzle types + Zod shapes. Everything in Phase 3+ depends on these.

**⚠️ CRITICAL**: No US1 or US2 work can begin until this phase is complete.

- [ ] T003 Create `packages/db/migrations/0003_wildcard_cert.sql` — idempotent SQL (`IF NOT EXISTS` throughout) creating `wildcard_certs` table (id uuid PK, org_id uuid FK→org, apex text, status text CHECK enum, account_email text, account_key_pem bytea, order_url text, challenge_records jsonb DEFAULT '[]', cert_pem text, key_pem bytea, not_before/not_after timestamptz, renewal_due boolean DEFAULT false, last_error text, issued_at timestamptz, created_at/updated_at/created_by/updated_by); UNIQUE INDEX on apex; and `cert_renewal_events` table (id uuid PK, cert_id uuid FK→wildcard_certs, org_id uuid FK→org, triggered_by text CHECK('initial','manual'), outcome text CHECK('success','failure','in_progress'), error_message text, cert_not_after timestamptz, started_at/finished_at timestamptz); indexes on cert_id+started_at and org_id+started_at
- [ ] T004 [P] Create `packages/db/src/schema/tls.ts` — Drizzle schema using `pgTable`, `uuid`, `text`, `bytea` (custom type), `jsonb`, `boolean`, `timestamp` types matching the migration exactly; export `wildcardCerts` and `certRenewalEvents` table objects
- [ ] T005 Export new schema in `packages/db/src/schema/index.ts` — add `export * from './tls.js'` line
- [ ] T006 [P] Add Zod types to `packages/shared/src/schemas.ts` — add `WildcardCertInitiateResponse` (apex, status, challengeRecords array of {name,value}, ttlHint), `WildcardCertVerifyResponse` (status union, dnsChecks array, allDnsReady, notBefore, notAfter, message), `WildcardCertStatusResponse` (cert nullable with all fields including renewalHistory array)

**Checkpoint**: `pnpm typecheck` passes; DB migration runs cleanly (`pnpm db:migrate`).

---

## Phase 3: User Story 1 — Issue Wildcard Certificate During /setup (Priority: P1) 🎯 MVP

**Goal**: Operator walks /setup, sees two TXT records to add, adds them at their registrar, clicks Verify, receives a `*.<apex>` Let's Encrypt cert loaded by Caddy. All subdomains served from the wildcard immediately. Per-subdomain on-demand TLS remains the fallback for deployments that skip the step.

**Independent Test**:
```bash
# On a fresh selfbase deployment with apex DNS configured:
curl -v https://<apex>/dashboard 2>&1 | grep "CN=\*\."
# → subject: CN=*.apex.com

curl -v https://<new-ref>.<apex>/rest/v1/ 2>&1 | grep "CN=\*\."
# → wildcard cert, first request < 500ms (no ACME handshake)

curl -s http://localhost:3001/api/wildcard-certs/status | jq .cert.status
# → "issued"
```

### Backend — ACME Service

- [ ] T007 [US1] Create `apps/api/src/services/acme.ts` — adapt `open-frontend/apps/api/src/services/acme-manual.ts` for selfbase: implement `initiateWildcardOrder(orgId, apex, email)` (generate/reuse ACME account key stored encrypted in `wildcard_certs.account_key_pem`, call `acme.Client.createAccount` idempotent, `createOrder([apex, *.apex])`, `getAuthorizations`, derive `_acme-challenge.<apex>` TXT record name and key-auth values for both authz, upsert `wildcard_certs` row with `status='awaiting_dns'` + `challenge_records`, insert `cert_renewal_events` with `outcome='in_progress'`), implement `verifyAndFinalize(apex)` (public DNS resolver check via `new Resolver(); r.setServers(['1.1.1.1','8.8.8.8','9.9.9.9'])` for all challenge values; if not found return early with DNS check results; recreate `acme.Client` with stored account key; `createAccount` idempotent; `getOrder(orderUrl)`; per-authz `completeChallenge`+`waitForValidStatus`; `createCsr({commonName:apex, altNames:[apex,*.apex]})`; `finalizeOrder`; `getCertificate`; write cert.pem+key.pem to `${SELFBASE_CERTS_DIR}/<apex>/` with mkdir recursive and correct modes; update `wildcard_certs` status='issued' + cert_pem + encrypted key_pem + notBefore/notAfter/issuedAt; update `cert_renewal_events` outcome='success'; insert audit log `tls.issued`), implement `loadRow(apex)` query, use `process.env.ACME_DIRECTORY_URL ?? acme.directory.letsencrypt.production`, use `encryptJson`/`decryptJson`/`loadMasterKey` from `@selfbase/crypto` for account key and cert key

### Backend — Caddy Config

- [ ] T008 [US1] Edit `apps/api/src/services/caddy-config.ts` — in `buildCaddyConfig()`: query `wildcardCerts` table for a row with `status='issued'`; if found, add `tls.certificates.load_files` block with `[{ certificate: '${CERTS_DIR}/<apex>/cert.pem', key: '${CERTS_DIR}/<apex>/key.pem', tags: ['wildcard:<apex>'] }]` to the `tlsApp` object; also add `tls_connection_policies: [{ match: { sni: [apex, '*.'+apex] }, certificate_selection: { any_tag: ['wildcard:'+apex] } }, {}]` to the `openfront_https` server object; when no cert row exists the config is identical to today (no `certificates` block, no `tls_connection_policies`)

### Backend — Routes

- [ ] T009 [US1] Create `apps/api/src/routes/wildcard-certs.ts` — `FastifyPluginAsync` exporting `wildcardCertRoutes`; register four routes using `app.authorize(req, 'org.update')` / `app.authorize(req, 'org.read')` guards:
  - `POST /wildcard-certs/initiate`: load org apex (409 if null), load admin email from users table, call `initiateWildcardOrder`, return 201 with `{ apex, status, challengeRecords, ttlHint }`
  - `POST /wildcard-certs/verify`: load org apex, call DNS check via public resolver for all challenge values, return `{ status: 'awaiting_dns', dnsChecks, allDnsReady: false }` if not ready, else call `verifyAndFinalize` and on success call `reloadCaddy()` then return `{ status: 'issued', notBefore, notAfter }`; on ACME failure return `{ status: 'failed', message }`
  - `GET /wildcard-certs/status`: load `wildcard_certs` row + `cert_renewal_events` history; if `status==='awaiting_dns'` re-run DNS check to populate live `found` flags per record; return full status shape per contracts/api.md
  - `DELETE /wildcard-certs`: set `status='disabled'`, rebuild+reload Caddy, insert audit log `tls.disabled`, return 204

- [ ] T010 [P] [US1] Edit `apps/api/src/routes/org.ts` — in `GET /org` handler, after loading the org row, run a second query to check if `wildcard_certs` has a row with `status='issued'` for this org; add `hasCert: boolean` field to the response object

- [ ] T011 [US1] Edit `apps/api/src/server.ts` — import and register `wildcardCertRoutes` in the authenticated routes section (same block as `orgRoutes`, `instanceRoutes`, etc.)

### Frontend — API Client

- [ ] T012 [P] [US1] Edit `apps/web/src/lib/api.ts` — add `wildcardCertApi` object with methods: `initiate()` → POST /api/wildcard-certs/initiate, `verify()` → POST /api/wildcard-certs/verify, `status()` → GET /api/wildcard-certs/status, `disable()` → DELETE /api/wildcard-certs; all use the existing `http` axios instance

### Frontend — Components

- [ ] T013 [P] [US1] Create `apps/web/src/components/WildcardCertCard.tsx` — reusable card showing: TXT record instructions (for each `challengeRecord`: hostname in a copyable `InputWithCopy`, value in a copyable `InputWithCopy`, TTL hint); per-record DNS status row (`⏳ Checking...` / `✅ Found` / `❌ Not found`) driven by `dnsChecks` prop; "Verify" button (always enabled, shows spinner while verifying); "Skip for now" link; error message box when `status === 'error'`; uses existing theme tokens (`s.form`, `s.label`, `s.buttonPrimary`, `s.buttonSecondary`, `theme.color.*`) from `apps/web/src/lib/theme.ts`

### Frontend — Setup Wizard Step 4

- [ ] T014 [US1] Edit `apps/web/src/pages/Setup.tsx` — add Step 4 (`step === 'wildcard-cert'`) immediately after the apex step (Step 3); the step uses sub-states:
  - `sub === 'loading'`: mounts → call `wildcardCertApi.initiate()` → advance to `'waiting'`
  - `sub === 'waiting'`: render `<WildcardCertCard>` with challenge records + live DNS checks; auto-poll `wildcardCertApi.status()` every 10s to update DNS `found` flags; "Verify" button → call `wildcardCertApi.verify()` → if `allDnsReady: false` stay in `'waiting'` with updated dnsChecks; if `status: 'issued'` advance to `'done'`; if `status: 'failed'` advance to `'error'`
  - `sub === 'done'`: show cert-issued card with `notAfter` expiry date; "Go to Dashboard" button → `window.location.href = 'https://' + apex + '/dashboard'`; auto-redirect after 3 seconds
  - `sub === 'error'`: show error message + "Try again" button (resets to `'loading'`) + "Skip for now" link
  - "Skip for now" link in `'waiting'` sub-state → `navigate('/')` (completes setup without wildcard)

**Checkpoint**: Full wizard flow works on VM. `curl -v https://<apex>` shows `CN=*.<apex>` from Let's Encrypt. New instance subdomains served by wildcard cert with < 500ms first request.

---

## Phase 4: User Story 2 — VM Reset + Renewal Alert (Priority: P1)

**Goal**: Operator can reset the VM and re-walk the wizard end-to-end cleanly. Dashboard alerts when cert is within 30 days of expiry. Operator can initiate renewal from the dashboard.

**Independent Test**:
```bash
# Renewal alert:
# Set wildcard_certs.not_after = NOW() + 25 days in DB
# Run cert-check job manually
# Dashboard shows renewal banner with expiry date and "Renew now" link

# VM reset:
# docker compose down -v   (drops pg-data, certs-data, caddy-data, redis-data)
# rm -rf /var/selfbase/instances /var/selfbase/certs /var/selfbase/backups
# docker compose up -d
# Walk /setup with TXT DNS-01 step → dashboard loads at https://<apex>/dashboard
```

### Backend — Cert-Check BullMQ Job

- [ ] T015 [US2] Create `apps/api/src/services/cert-check.ts` — implement `scheduleCertCheck(worker: Worker)` and `runCertCheck()`: query `wildcard_certs` where `status='issued'` AND `renewal_due=false` AND `not_after < NOW() + INTERVAL '30 days'`; for each matching row update `renewal_due=true` and `updated_at`; insert `audit_log` entry with `action='tls.renewal_due'`, `targetKind='wildcard_cert'`, `targetId=row.id`, `payload={apex, notAfter}`; export a BullMQ `Queue` named `'cert-check'` and a `Worker` that calls `runCertCheck()` once per run

- [ ] T016 [US2] Edit `apps/api/src/server.ts` — schedule the `cert-check` BullMQ job as a repeatable job with cron `'0 2 * * *'` (2 AM daily) when the server starts; import from `apps/api/src/services/cert-check.ts`

### Frontend — Renewal Banner

- [ ] T017 [P] [US2] Add renewal alert banner to the dashboard layout — in the appropriate dashboard layout/shell component (check `apps/web/src/pages/Dashboard.tsx` or layout wrapper), fetch `wildcardCertApi.status()` on mount; when `cert.renewalDue === true`, render a persistent `<div>` using `theme.color.warn` background showing "Your wildcard certificate expires on [notAfter formatted as date] — [Renew now →]" where "Renew now" navigates to the TLS settings route (or opens the wildcard-cert wizard step if no dedicated settings page exists yet); banner is dismissible per session (localStorage key) but reappears on next load

### Validation — VM Reset Smoke Test

- [ ] T018 [US2] Document and verify VM reset procedure in `docs/vm-reset.md` — write a step-by-step runbook: (1) `docker compose -f infra/docker-compose.yml down -v` to remove all volumes; (2) `rm -rf /var/selfbase/instances /var/selfbase/certs /var/selfbase/backups`; (3) `docker compose -f infra/docker-compose.yml up -d`; (4) wait for healthchecks; (5) navigate to `http://<VM-IP>/setup`; (6) walk full wizard including TXT step; (7) verify `curl https://<apex>/dashboard` returns 200 with Let's Encrypt wildcard cert; (8) provision one instance and verify `https://<ref>.<apex>/rest/v1/` returns 200; confirm the document exists and steps are correct by reading the plan's verification checklist

**Checkpoint**: VM wipe → re-setup → wildcard cert → dashboard working. Renewal banner visible when `not_after` < 30 days.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Audit log coverage, backward compat verification, TLS status dashboard panel, documentation.

- [ ] T019 [P] Verify backward compatibility in `apps/api/src/services/caddy-config.ts` — add a unit test (Vitest) in `apps/api/src/services/__tests__/caddy-config.test.ts` that calls `buildCaddyConfig()` with no `wildcard_certs` row in the DB and asserts: no `certificates` key in `tls` app, no `tls_connection_policies` in the HTTPS server, `automation.policies` contains only `{ on_demand: true }` — confirming zero behavioral change for existing deployments

- [ ] T020 [P] Add TLS status panel to dashboard settings — in `apps/web/src/pages/Settings.tsx` (or equivalent), add a "TLS / Certificates" section that fetches `wildcardCertApi.status()` and renders: cert status badge (issued/none/error), `notAfter` formatted date, issuer, SAN list, renewal history table with triggeredBy/outcome/date columns, "Disable wildcard" button (calls `wildcardCertApi.disable()` after confirmation), and for status==='none' a "Issue wildcard certificate" button that navigates to the wizard; use `<WildcardCertCard>` component for TXT display if re-initiating

- [ ] T021 [P] Update `docs/wildcard-tls.md` — create operator documentation covering: what the wildcard cert is and why it matters, step-by-step TXT record instructions (with screenshots if possible), how to find TXT record settings at common registrars (Cloudflare, Route 53, Namecheap, GoDaddy), renewal procedure, how to disable, troubleshooting (propagation delay, wrong values, ACME rate limits), link to issue #6 for future Cloudflare API automation

- [ ] T022 Verify ACME staging works — add `ACME_DIRECTORY_URL` env var documentation to `infra/.env.example` or equivalent env template; add a comment in `apps/api/src/services/acme.ts` explaining the staging override; confirm dev workflow: set `ACME_DIRECTORY_URL=https://acme-staging-v02.api.letsencrypt.org/directory` in `.env`, walk the wizard, verify cert is issued from "Fake LE" staging CA (not consuming LE production rate limits)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Requires Phase 1 — blocks all story work
- **Phase 3 (US1)**: Requires Phase 2 — all US1 tasks can start once DB schema is in place
- **Phase 4 (US2)**: Requires Phase 3 complete (cert-check job reads `wildcard_certs`); VM reset test requires the full wizard to work
- **Phase 5 (Polish)**: Requires Phase 3; T019 can run in parallel with Phase 4

### Within Phase 3 (US1)

- T007 (acme.ts) → T008 (caddy-config), T009 (routes) — all depend on T003–T006 being done
- T008, T009, T010, T012, T013 can run in parallel (different files)
- T011 (server.ts) depends on T009 (routes)
- T014 (Setup.tsx) depends on T012 (api.ts) and T013 (WildcardCertCard.tsx)

### Within Phase 4 (US2)

- T015 (cert-check.ts) → T016 (server.ts registration)
- T017 (dashboard banner) can run in parallel with T015
- T018 (VM reset doc + smoke test) requires T014 to be complete (full wizard)

---

## Parallel Execution Examples

### Phase 2 — Run in parallel
```
T003: Create 0003_wildcard_cert.sql
T004: Create packages/db/src/schema/tls.ts       ← can run alongside T003
T006: Add Zod schemas to shared/schemas.ts        ← can run alongside T003/T004
```

### Phase 3 — After T007 is done, run in parallel
```
T008: Edit caddy-config.ts
T009: Create routes/wildcard-certs.ts
T010: Edit routes/org.ts
T012: Edit web/src/lib/api.ts
T013: Create WildcardCertCard.tsx
```

### Phase 4 — Run in parallel
```
T015: Create cert-check.ts
T017: Dashboard renewal banner
T018: VM reset documentation
```

---

## Implementation Strategy

### MVP (US1 Only — Phases 1–3)

1. Phase 1: Add certs-data volume + acme-client dep (T001, T002)
2. Phase 2: DB migration + Drizzle schema + Zod types (T003–T006)
3. Phase 3 backend: acme.ts → caddy-config.ts → routes → server registration (T007–T011)
4. Phase 3 frontend: api.ts → WildcardCertCard → Setup.tsx Step 4 (T012–T014)
5. **STOP and VALIDATE**: Walk /setup on VM, verify wildcard cert, check new-instance subdomain

### Full Delivery

6. Phase 4: cert-check BullMQ job + dashboard renewal banner + VM reset smoke test (T015–T018)
7. Phase 5: Backward-compat test + TLS settings panel + docs + staging env (T019–T022)

---

## Notes

- `acme-client` npm usage: adapt `open-frontend/apps/api/src/services/acme-manual.ts` — it is the reference implementation. Key adaption points: DB calls use `db()` from `@selfbase/db`, encryption uses `encryptJson`/`loadMasterKey` from `@selfbase/crypto`, certs dir from `process.env.SELFBASE_CERTS_DIR`
- Caddy `tls_connection_policies` requires an empty trailing policy `{}` — without it, hostnames not matching the SNI pattern get TLS alert 80 (internal error) at handshake time
- `challenge_records` is always length 2 for `apex + *.apex` order — one per Let's Encrypt authorization — both values must exist simultaneously on `_acme-challenge.<apex>` as a multi-value TXT record
- VM wipe procedure removes `certs-data` volume — on re-setup, `initiateWildcardOrder` generates a fresh ACME account key and starts a new order cleanly
- ACME staging env: `ACME_DIRECTORY_URL=https://acme-staging-v02.api.letsencrypt.org/directory` — use this during development to avoid LE production rate limits (5 duplicate certs/week per domain)
