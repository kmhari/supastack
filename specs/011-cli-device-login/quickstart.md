# Quickstart — 011 CLI device-code login

End-to-end smoke for the live VM after deploy. Assumes the feature is fully implemented and rsync'd to `/opt/supastack`.

## Setup (one-time)

```bash
# On VM
cd /opt/supastack
sudo docker compose build api web
sudo docker compose up -d api web
```

Migration `0012_api_tokens_source.sql` runs automatically on api startup.

## US1 — Plain `supabase login` round-trip

On your laptop, with the supastack profile already wired (see Sept-25 chat or `~/.supabase/profile` pointing at `~/.config/supastack.toml`):

```bash
# 1. (Setup) Make sure you're signed into the dashboard in your browser at https://supaviser.dev/dashboard
# 2. From a fresh shell with no stored access-token:
rm -f ~/.supabase/access-token

supabase login
# CLI prints:
#   Hello from Supabase! Press Enter to open browser and login automatically.
#   Here is your login link in case browser did not open https://supaviser.dev/dashboard/cli/login?session_id=…&token_name=…&public_key=…

# Press Enter. Browser opens; dashboard auto-mints, displays 8-char verification code.
# Click "Copy code" in browser.
# Back in terminal:
#   Enter your verification code: <paste here, press Enter>

# Expected:
#   Token cli_<user>@<host>_<ts> created successfully.
#   You are now logged in. Happy coding!

# Verify
supabase projects list
# → lists your supastack projects (no --token, no env var)
```

**Time budget**: under 30 seconds end-to-end (SC-001).

## US3 — Replay rejection

```bash
# 1. After completing US1, copy the original CLI-login URL out of your terminal history
URL='https://supaviser.dev/dashboard/cli/login?session_id=…&token_name=…&public_key=…'

# 2. Paste it in the browser again
# Expected: "Unable to create CLI sign-in" error page (matches Cloud's screenshot)
# Expected: /settings/tokens shows ONLY the one cli-badged token from US1, not a second one
```

## US2 — Logged-out bounce

```bash
# 1. Open an incognito window (no supastack session)
# 2. Paste a fresh CLI-login URL (re-run `supabase login` to get one if needed)
# Expected: bounce to /login?next=<url-encoded-cli-login-url>
# 3. Sign in
# Expected: bounce back to /dashboard/cli/login?session_id=…&token_name=…&public_key=… → auto-mints → shows code
```

## US4 — Revoke from dashboard

```bash
# 1. Open https://supaviser.dev/settings/tokens
# Expected: the CLI-minted token from US1 is listed with a small "cli" badge next to its label
# 2. Click Revoke on that row, confirm
# 3. Back in terminal:
supabase projects list
# Expected: 401 unauthenticated
```

## Polling endpoint contract sanity

```bash
# Without ever opening the dashboard, you can confirm the polling endpoint behaves correctly:

# Unknown session → 404
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://api.supaviser.dev/platform/cli/login/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa?device_code=12345678'
# Expected: 404

# Malformed session_id → 404 (same body)
curl -s 'https://api.supaviser.dev/platform/cli/login/not-a-uuid?device_code=12345678'
# Expected: {"message":"session not found"} (byte-identical to above)

# Malformed device_code → 404
curl -s 'https://api.supaviser.dev/platform/cli/login/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa?device_code=zzz'
# Expected: {"message":"session not found"}
```

## Log-leak check (SC-008)

```bash
# After running US1 end-to-end:
ssh ubuntu@148.113.1.164 'sudo docker logs --tail 200 supastack-api-1 2>&1 | grep -E "sbp_[0-9a-f]{40}" || echo "no leaks ✓"'
ssh ubuntu@148.113.1.164 'sudo docker logs --tail 200 supastack-web-1 2>&1 | grep -E "sbp_[0-9a-f]{40}" || echo "no leaks ✓"'
```

Both should print `no leaks ✓`.

## Cleanup

```bash
# Revoke the test tokens via the dashboard, OR via API:
PAT=$(cat ~/.supabase/access-token)
TOKEN_ID=$(curl -sk 'https://api.supaviser.dev/api/v1/auth/tokens' -H "Authorization: Bearer ${PAT}" | jq -r '.[] | select(.label | startswith("cli_lord")) | .id' | head -1)
curl -sk -X DELETE "https://api.supaviser.dev/api/v1/auth/tokens/${TOKEN_ID}" -H "Authorization: Bearer ${PAT}"
```
