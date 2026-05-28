# oauth-test

Single-page `supabase-js` PKCE harness. Open it in a browser, click
**Sign in**, complete the provider's OAuth consent, watch the pill flip
to green with the resolved user payload.

## Run

```sh
cd tests/manual/oauth-test
python3 -m http.server 8765
open http://localhost:8765/
```

## What it does

- Constructs **one** `GoTrueClient` for the lifetime of the page
  (multiple instances race against the same `sb-<ref>-auth-token`
  localStorage key and produce confusing "checking session…" hangs).
- Subscribes once to `onAuthStateChange`; that subscription handles
  both the initial cold-load `INITIAL_SESSION` event and the post-
  callback `SIGNED_IN` event.
- On a **cold load** (URL has no `?code=` / `#access_token=`), purges
  any leftover `sb-*` localStorage keys so a previous run's stale
  `code_verifier` can't be replayed against a freshly-deleted user
  (otherwise GoTrue returns `500 "User not found"`).
- Pre-fills the project URL + anon key for the currently active test
  project (edit `DEFAULTS` in `index.html` to swap projects).
- Always writes the current `DEFAULTS` back to `localStorage` on load so
  swapping `DEFAULTS` in source forces the harness onto the new project
  even when the tab was already open.

## Operator prerequisites

For a GitHub round-trip:

1. The project's GitHub OAuth credentials must be saved
   (`/dashboard/project/<ref>/auth/providers` → GitHub drawer).
2. `http://localhost:8765/` (or `http://localhost:8765/**` for path
   wildcards) must be in the project's Redirect URLs allow-list
   (`/dashboard/project/<ref>/auth/url-configuration` — feature 022).
3. The GitHub OAuth App's "Authorization callback URL" must be
   `https://<ref>.<apex>/auth/v1/callback`.

## Expected outcome on success

| Stage                    | UI                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold load                | Pill: gray "signed out". Sign in button visible.                                                                                                                                                     |
| Click Sign in            | Browser navigates away → GitHub Authorize page.                                                                                                                                                      |
| Click Authorize          | Bounces through `/auth/v1/callback` → lands at `http://localhost:8765/?code=…`.                                                                                                                      |
| Token exchange completes | Pill: green "signed in as &lt;email-or-handle&gt;". JSON shows `user.id`, `email`, `provider: "github"`, `user_metadata` (avatar_url, user_name, full_name), `expires_at`, truncated `access_token`. |

## When something goes wrong

- **500 "User not found" on `/token` POST**: stale PKCE state being
  replayed against a deleted user. Hard-refresh the page on a clean URL
  (no `?code=`) so the cold-load purge runs.
- **"Unsupported provider: provider is not enabled" on `/authorize`**:
  the OAuth provider credentials aren't reaching GoTrue. Check the
  project's auth container env: `docker exec selfbase-<ref>-auth-1 env
| grep GOTRUE_EXTERNAL_<UPPER>_`. If empty, re-save from the dashboard
  Auth Providers drawer.
- **Final redirect lands on the project URL instead of localhost**:
  `http://localhost:<port>/**` isn't in the allow-list. Open the
  dashboard URL Configuration page, add it, watch the auth container
  reload, retry.
- **GitHub returns "redirect_uri mismatch"**: the GitHub OAuth App's
  callback URL must point at the per-project GoTrue endpoint
  (`https://<ref>.<apex>/auth/v1/callback`), NOT at localhost.
