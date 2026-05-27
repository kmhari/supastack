# Research: T077 — Silent OAuth Token Refresh Validation

## Access Token TTL

- **Decision**: Use the production TTL as-is: `ACCESS_TOKEN_TTL_SEC = 3600` (1 hour), defined in `apps/api/src/routes/oauth/token.ts:25`.
- **Rationale**: Validating the production contract requires the actual production behaviour. Reducing TTL for test speed would require a code change to production logic and would not validate that the refresh contract holds at the 1-hour mark.
- **Alternatives considered**: Short-circuit TTL via env var — rejected: adds production code complexity for a one-shot test; the wait is acceptable for an operator-run smoke.

## Wait strategy

- **Decision**: `sleep $((EXPIRES_IN + 60))` where `EXPIRES_IN` is read from the token endpoint response (`expires_in` field). Total wait ≈ 61 minutes.
- **Rationale**: Reading `expires_in` from the response rather than hardcoding 3600 means the script self-adapts if TTL is ever changed on the server. The +60s buffer tolerates clock skew and processing latency.
- **Confirm expiry**: After the sleep, call `GET /v1/profile` with the old access token and assert 401 before proceeding. This is the negative-path gate from FR-003 — the test does not skip to the refresh step if, for any reason, the original token is not actually expired.

## Refresh token rotation

- `rotateRefresh` in `apps/api/src/services/oauth-refresh-store.ts` issues a new `randomBytes(32).toString('base64url')` token and deletes the old row. The new row links back via `previousToken`.
- Reuse-detection fires if the old (now-deleted) row is tried again: it finds the child row → revokes the entire (user, client) grant → returns `reuse_detected` → token endpoint returns HTTP 400 `invalid_grant`.
- The smoke must NOT call the refresh endpoint twice with the same token. The existing `oauth-dance.sh` step 7 already validates reuse-detection immediately; the new smoke deliberately avoids exercising that path (we want the happy path to succeed).

## Protected endpoint for validation

- **Decision**: `GET /v1/profile` — already used in steps 5 and 8 of `oauth-dance.sh` for identical purpose. Returns 200 with operator's profile on valid JWT bearer; returns 401 on expired/invalid token.
- **Rationale**: Smallest footprint, already battle-tested by the existing smoke.

## Script reuse pattern

- **Decision**: New standalone script `tests/cli-e2e/t077-silent-refresh.sh`. Steps 1–4 (DCR, PKCE, authorize, token exchange) are copied from `oauth-dance.sh` with minimal changes. The new script then diverges: it records `expires_in`, sleeps, asserts 401, and performs the post-expiry refresh cycle.
- **Rationale**: Sourcing `oauth-dance.sh` would couple the new script to the internals of the other; copying the setup steps keeps the new script self-contained and directly readable by a fresh operator.

## Outcome record

- **Decision**: Structured stdout lines prefixed `[T077]` with timestamp, step name, status code, and elapsed seconds. On failure, `FAIL:` prefix + response body. Final line is either `[T077] PASS: SC-003 validated` or `[T077] FAIL: ...`. No separate file written by default — operators redirect stdout to a file if needed.
- **Rationale**: Consistent with the rest of `tests/cli-e2e/` (all scripts write structured stdout). Keeping the outcome in stdout lets the operator tee to a file, post to a GitHub issue, or inspect interactively — no new infra.

## No new API endpoints, schema changes, or RBAC actions

This feature exercises only existing endpoints. No migrations, no new routes, no schema changes, no new RBAC actions.
