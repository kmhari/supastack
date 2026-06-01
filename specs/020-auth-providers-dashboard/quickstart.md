# Quickstart: Auth Providers Dashboard + Behavioral Parity

**Feature**: 020-auth-providers-dashboard | **Date**: 2026-05-28

Operator-facing smoke tests + SRE-facing API checks. Run after every deploy of this feature to `supaviser.dev`.

---

## Prerequisites

- Admin role on `supaviser.dev`
- An existing test project (ref noted as `$TEST_REF`)
- A throwaway Google OAuth client (Client ID + Secret) registered against `https://$TEST_REF.supaviser.dev/auth/v1/callback`
- An operator PAT (`$PAT`) exported in your shell

---

## Smoke 1 — Configure Google end-to-end from the dashboard (US1)

1. Log in to `https://supaviser.dev/dashboard` as admin
2. Open the test project → click `Authentication` in the sidebar → click `Providers`
3. Verify the page lists: top 4 toggles + Email + Phone + SAML (Coming soon) + Web3 Wallet (Coming soon) + 21 OAuth provider rows (20 unique providers, Slack as two rows) + Custom Providers section (Coming soon)
4. Click the Google row
5. Drawer opens; Callback URL field shows `https://$TEST_REF.supaviser.dev/auth/v1/callback` (Copy button works)
6. Paste your Google Client ID + Secret; toggle Enable; click Save
7. Drawer closes; toast appears: "Restarting auth — your changes will be live in ~30s"
8. Wait ~30s; toast flips to "Settings applied"; Google row status pill flips from Disabled to Enabled
9. From a sample app: visit `https://$TEST_REF.supaviser.dev/auth/v1/authorize?provider=google` → redirected to Google's OAuth consent screen with the configured `client_id`
10. Complete the consent; verify redirect back to your sample app with a valid session

**Pass**: all 10 steps succeed with zero CLI or SSH intervention.

---

## Smoke 2 — Verify the 17-OAuth-provider promotion (US3)

Without using the dashboard:

```bash
# Pick a freshly-promoted provider (e.g. Discord)
curl -X PATCH "https://supaviser.dev/v1/projects/$TEST_REF/config/auth" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d '{"external_discord_enabled":true,"external_discord_client_id":"test","external_discord_secret":"test"}'

# Wait ~30s for restart
sleep 35

# Confirm the env line was written
ssh ubuntu@148.113.1.164 'sudo cat /var/supastack/instances/'$TEST_REF'/.env | grep DISCORD'

# Expected:
#   DISCORD_ENABLED=true
#   DISCORD_CLIENT_ID=test
#   DISCORD_SECRET=test

# Confirm the running container picked it up
ssh ubuntu@148.113.1.164 'sudo docker exec supastack-'$TEST_REF'-auth env | grep DISCORD'
```

**Pass**: env vars present in BOTH the .env file AND the running container's env.

---

## Smoke 3 — Verify the transparency layer (US4)

```bash
curl -s -H "Authorization: Bearer $PAT" \
  "https://supaviser.dev/v1/projects/$TEST_REF/config/auth" | jq '._supastack.fieldStatus | {
    honored_count: ([.[] | select(.status=="honored")] | length),
    stored_only_sample: (.saml_enabled),
    unsupported_sample: (.oauth_server_enabled)
  }'

# Expected:
# {
#   "honored_count": 160-170,              # target 165, ±5 — see research R-001
#   "stored_only_sample": {
#     "status": "stored_only",
#     "reason": "no SAML keypair infrastructure — see #61"
#   },
#   "unsupported_sample": {
#     "status": "unsupported",
#     "reason": "Cloud-only OAuth authorization server — see #63"
#   }
# }
```

**Pass**: honored count is in the expected range; reason text references the right tracking issue.

---

## Smoke 4 — CLI compatibility unchanged (SC-005)

```bash
# Using the unmodified upstream Supabase CLI
supabase login --token $PAT
supabase link --project-ref $TEST_REF
supabase config get --auth

# Should print the auth config without errors, ignoring the _supastack key.
```

**Pass**: CLI exits 0; output contains the expected fields.

---

## Smoke 5 — Mailer subject promotion (US3 sample)

```bash
curl -X PATCH "https://supaviser.dev/v1/projects/$TEST_REF/config/auth" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d '{"mailer_subjects_invite":"You'\''ve been invited to my app"}'

sleep 35

# Trigger an invite from the dashboard or supabase CLI
supabase admin generate link --type invite --email test+invite@example.com

# Check the inbox or the mail-capture target — subject should be the new value
```

**Pass**: captured invite email has the configured subject.

---

## Smoke 6 — Rate limit promotion (US3 sample)

```bash
curl -X PATCH "https://supaviser.dev/v1/projects/$TEST_REF/config/auth" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d '{"rate_limit_email_sent":1}'

sleep 35

# Trigger 2 password resets in quick succession
for i in 1 2; do
  curl -X POST "https://$TEST_REF.supaviser.dev/auth/v1/recover" \
    -H "apikey: $TEST_ANON_KEY" -H "Content-Type: application/json" \
    -d '{"email":"victim+'$i'@example.com"}' -w "\nHTTP %{http_code}\n"
done

# Expected: first → HTTP 200, second → HTTP 429
```

**Pass**: second request returns 429.

---

## Smoke 7 — Coming-soon rows (US5)

In the dashboard:
1. Verify SAML 2.0, Web3 Wallet, Custom Providers each show as disabled rows with "Coming soon" pill
2. Click each → no drawer opens
3. Click the badge → navigates to GitHub issue (#61, #72, #63 respectively)

**Pass**: all three behaviors confirmed.

---

## Smoke 8 — RBAC enforcement (SC-008)

1. Log in to the dashboard as a non-admin team member
2. Open Auth → Providers
3. Verify: status pills visible; toggles disabled or hidden; Save buttons absent
4. Try to PATCH directly:
   ```bash
   curl -X PATCH "https://supaviser.dev/v1/projects/$TEST_REF/config/auth" \
     -H "Authorization: Bearer $NONADMIN_PAT" -H "Content-Type: application/json" \
     -d '{"jwt_exp":7200}'
   # Expected: HTTP 403
   ```

**Pass**: dashboard hides Save; direct PATCH returns 403.

---

## Smoke 9 — Restart-failure UX (edge case)

To simulate: SSH to the VM, manually corrupt the `.env` for the test project (e.g. add a syntactically invalid line), then issue a benign PATCH from the dashboard.

1. Save in any drawer
2. Toast appears as usual
3. Container fails to start; healthcheck times out at 60s
4. Toast flips to error state with Retry button
5. Row status pill reverts to its pre-Save value
6. Clean up the corrupted .env on the VM and retry — succeeds

**Pass**: failure is surfaced; pill reverts; retry works after fixing the underlying cause.

---

## Smoke 10 — Run the behavioral parity test (CI gate)

```bash
SUPASTACK_APEX=supaviser.dev SUPASTACK_PAT=$PAT SUPASTACK_TEST_PROJECT_REF=$TEST_REF \
  bash tests/cli-e2e/auth-config-behavioral-parity.sh
```

**Pass**: script prints `[BEHAVIORAL] ALL 165 ASSERTIONS PASSED` and exits 0. Wall-clock < 10 min.
