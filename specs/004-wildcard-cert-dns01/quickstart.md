# Quickstart: Wildcard TLS Cert via DNS-01

**Feature**: 004-wildcard-cert-dns01 | **Date**: 2026-05-23 | **Updated**: 2026-05-23 (post-clarification)

---

## Scenario 1: Happy Path — First-Time Setup with Wildcard Cert

**Pre-condition**: Fresh selfbase VM. Apex DNS A record (`selfbase.example.com → <VM IP>`) already configured. Operator has access to add TXT records at their registrar (any DNS provider).

**Steps**:
1. Navigate to `http://<VM-IP>/setup` — redirected automatically.
2. Step 1: Enter admin email, password, org name → Continue.
3. Step 2: Copy the master API token → Continue.
4. Step 3: Enter `selfbase.example.com` → DNS A record verified → Continue.
5. Step 4 (new — DNS-01 cert): Wizard shows:
   ```
   Add these TXT records at your DNS registrar:
   
   Host:    _acme-challenge.selfbase.example.com
   Value 1: abc123base64urlvalue1...
   Value 2: def456base64urlvalue2...
   TTL:     60 seconds
   
   Both values must be present on the same record.
   ```
6. Operator adds the two TXT values at their registrar.
7. Wizard auto-polls every 10s — DNS status updates: `⏳ Value 1: propagating` / `✅ Value 2: found`.
8. Once both show ✅, operator clicks "Verify" (or wizard auto-verifies).
9. Progress card: `Completing ACME challenge... → Downloading certificate... → Certificate issued ✓`
10. Wizard: "Wildcard certificate issued. Valid until 2026-08-23."
11. "Go to dashboard" → browser navigates to `https://selfbase.example.com/dashboard`.

**Verify** (SC-001, SC-002):
```bash
curl -v https://selfbase.example.com 2>&1 | grep -E "subject|issuer|CN="
# subject: CN=*.selfbase.example.com
# issuer: Let's Encrypt

curl -v https://<new-ref>.selfbase.example.com/rest/v1/ 2>&1 | grep -E "subject|issuer"
# Same wildcard cert — zero ACME handshake delay
```

---

## Scenario 2: DNS Not Yet Propagated — Retry Path

**Pre-condition**: Operator adds TXT records, clicks "Verify" immediately before DNS has propagated.

**Steps**:
1. Click "Verify" → response: `{ status: 'awaiting_dns', dnsChecks: [{ found: false }, { found: false }] }`
2. Wizard shows: "TXT records not yet visible in DNS. This can take 1-5 minutes."
3. Wizard continues auto-polling every 10s.
4. After 2 minutes: both records appear in DNS → wizard auto-calls Verify → cert issued.

**Verify** (SC-006): No stuck state. Retry works without restarting /setup. ACME order is preserved.

---

## Scenario 3: Only One TXT Value Added (Partial)

**Pre-condition**: Operator accidentally adds only one of the two TXT values.

**Steps**:
1. DNS status shows: `✅ Value 1: found` / `⏳ Value 2: propagating...`
2. Operator clicks Verify → response: `{ allDnsReady: false, dnsChecks: [{ found: true }, { found: false }] }`
3. Wizard shows: "Record `_acme-challenge.selfbase.example.com` is missing value 2: `def456...`. Add it at your registrar and retry."
4. Operator adds the second value → both show ✅ → Verify → cert issued.

---

## Scenario 4: Skip DNS Provider (On-Demand TLS Fallback)

**Pre-condition**: Operator's registrar doesn't support multi-value TXT records (edge case) or operator wants to skip for now.

**Steps**:
1. Step 4: Wizard shows TXT records + "Skip for now" link.
2. Operator clicks "Skip for now" → wizard advances to dashboard directly.
3. Per-instance subdomains use on-demand HTTP-01 TLS (existing behavior).
4. Dashboard shows: "Wildcard TLS not configured. Issue a wildcard certificate to eliminate per-request cert delays."

**Verify** (SC-007): Full platform usable. Instances serve HTTPS normally via on-demand per-subdomain certs.

---

## Scenario 5: Post-Setup — Issue Wildcard for Existing Deployment

**Pre-condition**: Operator completed /setup before this feature shipped (no wildcard cert). Dashboard shows "Wildcard TLS not configured" banner.

**Steps**:
1. Click the banner link → Settings → TLS → "Issue wildcard certificate".
2. Same TXT record flow as Scenario 1.
3. On cert issuance: `reloadCaddy()` updates Caddy config with `load_files` + `tls_connection_policies`.
4. All subdomains (including existing ones) now served from wildcard. Existing per-subdomain ACME certs in `caddy-data` remain until natural expiry.

**Verify** (FR-009, FR-010): Existing projects still serve HTTPS. No downtime during transition.

---

## Scenario 6: Renewal Alert (30-Day Warning)

**Pre-condition**: Wildcard cert issued. 29 days before expiry, the daily `cert-check` BullMQ job runs.

**Steps**:
1. Job finds `not_after - now() < 30 days` → sets `renewal_due = true`.
2. Dashboard: persistent banner appears: "Your wildcard certificate expires on 2026-08-21 (in 29 days). Renew now →"
3. Operator clicks "Renew now" → `POST /api/wildcard-certs/initiate` → new ACME order created with new TXT values.
4. Operator adds the new TXT values at registrar → Verify → new cert issued.
5. `renewal_due` cleared → banner disappears.

**Verify** (SC-004, FR-013): Banner appears ≥ 30 days before expiry. Platform continues serving old cert throughout (still valid).

---

## Scenario 7: VM Wipe and Re-Setup (SC-005)

**Pre-condition**: Full selfbase stack was running with wildcard cert. VM wiped: Docker volumes removed (pg-data, certs-data, caddy-data, redis-data), selfbase containers removed, DB data cleared. Host DNS still points at same IP.

**Steps**:
1. Run `install.sh` on fresh state.
2. Navigate to `http://<VM-IP>/setup`.
3. Walk entire wizard including Step 4 — TXT records shown (new ACME order).
4. Add TXT records at registrar → Verify → cert issued → `https://<apex>/dashboard` loads.
5. Create a new instance → `<ref>.<apex>` serves HTTPS immediately (wildcard covers it).

**Verify**: Production smoke-test sequence runs cleanly. This is the acceptance test for US2.

---

## Scenario 8: Disable Wildcard

**Pre-condition**: Wildcard cert active. Operator migrating DNS to unsupported provider.

**Steps**:
1. Settings → TLS → "Disable wildcard TLS" → confirmation dialog → confirm.
2. `DELETE /api/wildcard-certs` → `wildcard_certs.status = 'disabled'` → Caddy reloaded.
3. Dashboard: "Per-subdomain on-demand TLS is now active."
4. Cert+key files remain on disk but Caddy no longer references them.
5. New projects issue per-subdomain certs on first request (existing on-demand behavior).

**Verify** (FR-011): Caddy admin config shows no `load_files` or `tls_connection_policies`. New subdomains issue per-subdomain certs.
