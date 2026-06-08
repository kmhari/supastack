# Quickstart: Testing OAuth Authorize Flow (Feature 115)

## End-to-End Smoke Test (curl + browser)

### 1. Register a test client
```bash
curl -s -X POST https://api.supaviser.dev/v1/oauth/clients \
  -H "Content-Type: application/json" \
  -d '{"client_name":"Test MCP","redirect_uris":["http://localhost:9999/callback"]}' | jq .
# → { "client_id": "<UUID>", "client_secret": "..." }
export CLIENT_ID="<UUID from above>"
```

### 2. Generate PKCE verifier+challenge
```bash
VERIFIER=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=')
STATE=$(openssl rand -base64 16 | tr '+/' '-_' | tr -d '=')
echo "verifier=$VERIFIER challenge=$CHALLENGE state=$STATE"
```

### 3. Open authorize URL in browser
```
https://supaviser.dev/v1/oauth/authorize?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcallback&state=<STATE>&code_challenge=<CHALLENGE>&code_challenge_method=S256&scope=projects%3Aread
```
**Expected**: Browser is redirected to `https://supaviser.dev/dashboard/authorize?auth_id=<UUID>`.

### 4. Verify Studio consent page loads
**Expected**: The Studio consent page shows "Test MCP" requesting "Read access to all projects", with your logged-in email and Authorize/Deny buttons.

### 5. Click Authorize
**Expected**: Browser navigates to `http://localhost:9999/callback?code=<CODE>&state=<STATE>`.

### 6. Exchange code for token
```bash
curl -s -X POST https://api.supaviser.dev/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=<CODE>&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcallback&client_id=$CLIENT_ID&code_verifier=$VERIFIER" | jq .
# → { "access_token": "...", "token_type": "bearer", "expires_in": 3600, "refresh_token": "..." }
```

## API-Level Tests (integration assertions)

### Test: Auth session creation
```bash
# After step 3 above, verify session was created in Redis
# (dev only — not exposed externally)
redis-cli GET oauth:auth_session:<auth_id>
# → JSON with name, scopes, expires_at, etc.
```

### Test: GET /platform/oauth/authorizations/:auth_id
```bash
curl -s https://api.supaviser.dev/platform/oauth/authorizations/<auth_id> \
  -H "Authorization: Bearer <access_token>" | jq .
# → { name, website, icon, domain, scopes, expires_at, approved_at: null }
```

### Test: Replay protection
```bash
# After approving, attempt to GET the same auth_id
curl -s https://api.supaviser.dev/platform/oauth/authorizations/<auth_id> \
  -H "Authorization: Bearer <access_token>"
# → 404 (session consumed)
```

### Test: Deny flow
```bash
curl -s -X DELETE https://api.supaviser.dev/platform/organizations/<org_slug>/oauth/authorizations/<auth_id> \
  -H "Authorization: Bearer <access_token>"
# → 200 { "id": "<auth_id>" }
# Studio would also redirect to /organizations page
```
