# API token expiry & the grace transition

Personal access tokens (PATs) — the `sbp_…` tokens used by the `supabase` CLI,
MCP, and automation — now carry an expiry. This doc is the operator runbook for
rolling that out without invalidating tokens people are still using.

## The lifetime model

A PAT is accepted only while **both** hold:

- **Absolute cap** — it was issued less than `PAT_ABSOLUTE_MAX_DAYS` ago
  (default **365**; Studio-minted tokens use the shorter `PAT_STUDIO_MAX_DAYS`,
  default **90**).
- **Idle cap** — it was last used within `PAT_IDLE_MAX_DAYS` (default **90**).

Both are stored/enforced in the control-plane DB. A token with `expires_at IS
NULL` is **grandfathered** (minted before this feature) and never expires until
you backfill it — see below.

| Env                     | Default | Meaning                                                                  |
| ----------------------- | ------- | ------------------------------------------------------------------------ |
| `PAT_ABSOLUTE_MAX_DAYS` | 365     | Max age from issuance.                                                   |
| `PAT_STUDIO_MAX_DAYS`   | 90      | Absolute cap for dashboard-minted tokens.                                |
| `PAT_IDLE_MAX_DAYS`     | 90      | Max gap since last use.                                                  |
| `PAT_SUNSET_WARN_DAYS`  | 30      | Emit a `Sunset` header this many days before expiry.                     |
| `PAT_IDLE_GRACE_UNTIL`  | _unset_ | ISO date; while now < this, idle expiry is **not** enforced (see grace). |

## The `Sunset` header

Any PAT-authenticated response within `PAT_SUNSET_WARN_DAYS` of expiry carries an
RFC 8594 `Sunset: <http-date>` header. This reaches CLI/automation callers who
never open the dashboard — the only channel that warns a headless integration
before its token dies.

## Rolling it out (announced transition)

New tokens expire from day one — no action needed. Existing grandfathered tokens
(`expires_at IS NULL`) stay valid until you decide to bring them into the model.
The safe sequence:

1. **Announce** the cutover date to your users (~90 days out is typical).
2. **Set the grace window** so the backfill doesn't idle-out dormant tokens the
   moment you stamp them. In `infra/.env`:

   ```
   PAT_IDLE_GRACE_UNTIL=2026-11-01
   ```

   While now is before that date, only the **absolute** cap applies; a parked
   token that hasn't been used in months keeps working through the window.
   Unset / past / malformed → idle enforced (the steady state).

3. **Backfill** grandfathered tokens (idempotent — safe to re-run):

   ```sql
   UPDATE api_tokens
   SET expires_at = GREATEST(now() + interval '90 days',
                             created_at + interval '365 days')
   WHERE expires_at IS NULL
     AND revoked_at IS NULL;
   ```

   This gives every existing token at least 90 days from the backfill and never
   shortens one already older than its absolute cap below that floor.

4. **After the grace date passes**, remove `PAT_IDLE_GRACE_UNTIL`. Idle expiry is
   now enforced for everyone.

The backfill is **operator-invoked on purpose** — it is not an automatic boot
migration, so deploying this feature never silently invalidates a token. You
choose when tokens start aging, after your users have been told.

## Auditing what's outstanding

`GET /admin/credentials` (admin-console read role) lists every token with its
source, owner, last-used time, `expires_at`, and status (`active` / `expired` /
`revoked`). It never returns the token secret — only the display prefix.
