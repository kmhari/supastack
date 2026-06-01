# Contract — Internal endpoints

These endpoints are **not** part of the public API. They are bound to the Docker internal network only and are not exposed via Caddy's public routes.

## `GET /internal/tls/ask`

Called by Caddy's on-demand TLS gating before issuing a certificate for any subdomain.

**Query parameter**: `domain` — the hostname Caddy is being asked to serve.

**Behaviour**: returns 200 if and only if the domain is admissible for certificate issuance:

- `domain` == `org.apex_domain` (the dashboard apex), OR
- `domain` matches `<ref>.<apex>` where the corresponding `supabase_instances` row exists and `status NOT IN ('deleting')`.

**Responses**:
- **200** body irrelevant
- **404** body irrelevant

Caddy treats any non-2xx response as deny.

**Authentication**: none — endpoint is only reachable from inside the Docker network.

**Implementation notes**:
- The handler MUST be fast and side-effect-free. No DB writes; cached lookups encouraged (per-process LRU, 60 s TTL) to absorb cert renewal storms.
- Logs every "deny" decision at INFO with the requested domain — surfaces misconfigured DNS before operators notice via TLS errors.

## Caddy admin API consumption

Supastack calls Caddy's admin API at `http://caddy:2019/load` with the full JSON config produced by `apps/api/src/services/caddy-config.ts`. This is an outbound call from supastack, not an inbound one — listed here for completeness.

- Method: `POST`
- Body: `application/json` — full Caddy JSON config
- Expected status: **200** on success; non-2xx logged and the job retries with backoff.
- Atomicity: Caddy's `/load` swaps the config in one step; no partial-update window.

## Worker → API callbacks

Not used in v1. Worker writes state directly to Postgres (it has direct DB access). Future MCP/webhook integrations can add an internal callback endpoint if needed.
