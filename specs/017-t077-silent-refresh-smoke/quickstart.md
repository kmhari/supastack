# Quickstart: T077 — Silent OAuth Token Refresh Validation

**Target**: supaviser.dev (production VM)  
**Duration**: ~62 minutes (1h access token TTL + setup + verification)  
**Prerequisites**: `curl`, `jq`, `openssl`, a valid `sb_sid` cookie from the dashboard

## Run

```bash
SELFBASE_APEX=supaviser.dev \
SELFBASE_SESSION_COOKIE='<paste sb_sid cookie value from browser>' \
bash tests/cli-e2e/t077-silent-refresh.sh
```

Get the session cookie: open `https://api.supaviser.dev` in a browser → sign in → DevTools → Application → Cookies → copy value of `sb_sid`.

## What it does

1. Registers a DCR client and completes the full OAuth 2.1 authorization code + PKCE flow → captures `access_token`, `refresh_token`, `expires_in`.
2. Immediately calls `GET /v1/profile` to confirm the access token is valid at issuance.
3. Sleeps `expires_in + 60` seconds (~61 minutes) to let the access token genuinely expire.
4. Calls `GET /v1/profile` with the original access token → asserts **401** (negative-path gate).
5. Calls `POST /v1/oauth/token` with `grant_type=refresh_token` → asserts new access + refresh tokens issued, refresh token rotated.
6. Calls `GET /v1/profile` with the new access token → asserts **200** (contract confirmed).
7. Prints `[T077] PASS: SC-003 validated` and exits 0.

Any step failure exits 1 with `[T077] FAIL: ...` and the HTTP status + response body.

## Closing issue #54 T077

After a successful run, paste the final `[T077] PASS` line (including `issued_at` and `refreshed_at` timestamps) as a comment on issue #54 and tick the T077 acceptance checkbox.
