# Contract: pg-edge-proxy (Direct Postgres Endpoint)

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23

A small TCP service in the selfbase api container. Listens on port 5432. Speaks Postgres protocol just enough to handle STARTTLS, terminates TLS with the wildcard cert, extracts tenant ref from SNI, and forwards the plaintext stream to the per-instance Postgres backend.

---

## Public Interface

**Port**: 5432 (TCP)
**Protocol**: Postgres wire protocol (only the SSLRequest preamble is parsed; everything after TLS handshake is opaque bytes)

**Client-side requirements**:
- `sslmode=require` (or higher) — connections without TLS are rejected
- Username = `postgres` (or whatever role exists in the per-instance Postgres); no `.tenantid` suffix needed
- Hostname = `db.<ref>.<apex>` (must match `apex_domain` configured in selfbase)
- Standard Postgres clients work out of the box: `psql`, `libpq`, `node-postgres`, `pg-promise`, Python `psycopg`, Go `pgx`, `supabase` CLI, every supabase-js variant

---

## Per-Connection Flow

```
1. Client → TCP connect to <vm-ip>:5432

2. Client → 8 bytes:
     length=8 (4 bytes BE) + magic=80877103 (0x04D2162F, 4 bytes BE)
     (this is Postgres SSLRequest)

3. Proxy validates: if first 8 bytes ≠ SSLRequest preamble → close
                  if equals → write 'S' (0x53) one byte to client

4. Client → standard TLS ClientHello (with SNI = hostname they connected to)

5. Proxy completes TLS handshake using wildcard cert + key from
   /var/selfbase/certs/<apex>/{cert,key}.pem
   (loaded once at startup; SIGHUP reloads on cert renewal)

6. After handshake, proxy reads tlsSocket.servername (the SNI)
     Validates regex: ^db\.([a-z]{20})\.<apex>$
     If no match → close with TLS close_notify

7. Proxy looks up backend for ref:
     - Cached for 60s
     - Query: SELECT port_postgres_direct FROM supabase_instances
              WHERE ref = $1 AND status != 'deleting'
     - If no row → close with TLS close_notify

8. Proxy opens TCP to host.docker.internal:<port_postgres_direct>

9. Bidirectional pipe:
     tlsSocket (plaintext post-TLS bytes) ←→ backendSocket
     - Both sides propagate close
     - On any error, both sockets destroyed
     - No buffering, no inspection — pure byte forwarding
```

---

## Failure Modes (graceful close, never crash)

| Failure | Action |
|---|---|
| First 8 bytes aren't SSLRequest | Close socket immediately. No log spam — likely scanners. |
| TLS handshake fails (bad cert, no SNI, etc.) | Log at debug; close. |
| SNI doesn't match `db.<ref>.<apex>` pattern | Log warn with sni; close. |
| Ref not found in `supabase_instances` | Log warn with ref; close. Client sees clean disconnect. |
| Backend TCP refused / unreachable | Log warn; close client connection. Client sees clean disconnect. |
| Mid-stream error on either side | Destroy both sockets. Client/backend handles per Postgres protocol semantics. |
| Cert files missing at startup | api container fails to start (loud — operator visible). |

---

## Configuration

Read at startup from env + filesystem:

| Source | Value |
|---|---|
| `process.env.PG_EDGE_PROXY_PORT` (default 5432) | Listen port |
| `process.env.SELFBASE_CERTS_DIR` (default `/var/selfbase/certs`) | Cert root |
| `org.apex_domain` from DB (read at startup, refresh on apex change event) | Used in SNI regex + cert path |
| `org.apex_domain` → cert at `${SELFBASE_CERTS_DIR}/${apex}/cert.pem` + `key.pem` | TLS material |

**Cert reload**: subscribe to a Redis pub/sub channel `selfbase:wildcard-cert:reloaded`. Feature 004's renewal flow publishes after rewriting cert files. On message, the proxy re-reads files and swaps the TLS context atomically. New connections use the new cert; in-flight connections finish on the old.

**Apex change**: rebuild the SNI regex. Same Redis channel `selfbase:apex:changed` — when the dashboard changes apex (rare), the proxy updates its filter.

---

## Backend Lookup Cache

In-memory `Map<string, { host, port, expiresAt }>` with 60s TTL.

- Cache miss → DB query → populate
- Cache hit → use without DB query
- On instance delete (api emits Redis event `selfbase:instance:deleted`) → invalidate cache for that ref immediately

Why 60s and not longer: covers transient API/DB hiccups; short enough that instance lifecycle changes propagate quickly without explicit invalidation.

---

## Observability

The proxy emits Prometheus-format metrics on `/internal/pg-edge-metrics` (Fastify route in same api container):

- `pg_edge_connections_total{ref="..."}` — counter
- `pg_edge_connections_active{ref="..."}` — gauge
- `pg_edge_backend_dial_errors_total{ref="..."}` — counter
- `pg_edge_sni_unknown_total` — counter (unmatched SNIs)
- `pg_edge_tls_handshake_errors_total` — counter

Scraped by the dashboard's Database Connection panel alongside supavisor metrics.

---

## Test Coverage

Unit tests in `apps/api/src/services/__tests__/pg-edge-proxy.test.ts`:

1. Valid SSLRequest → 'S' response → TLS handshake with mock cert → SNI extracted → backend mock connection opened → bidirectional bytes forwarded
2. Wrong preamble → connection closed
3. SNI doesn't match regex → close after TLS handshake
4. Ref not in DB → close
5. Backend dial fails → client connection closes gracefully
6. Cert reload signal → next connection uses new cert
7. Apex change signal → SNI regex updates

Integration test in `tests/cli-e2e/db-push.sh` (existing — exercises real `supabase db push` via the proxy).

---

## Why Not …

| Alternative | Why rejected |
|---|---|
| caddy-l4's postgres matcher | Detects SSLRequest but doesn't write `'S'` response (proven in earlier VM test) |
| HAProxy | Same issue — no native Postgres STARTTLS handler; would need Lua |
| Top-level supavisor for direct endpoint | Has SNI-lookup bug in v2.7.4 (proven in VM test); CLI doesn't use `postgres.<ref>` username |
| pgcat / pgbouncer | Routing is by db name or username, not SNI |
| Pre-built Go binary | More moving parts; same byte-forwarding can be done in <100 lines of Node.js |
