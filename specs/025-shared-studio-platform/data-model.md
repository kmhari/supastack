# Data Model: Shared Studio Platform

**Feature**: 025-shared-studio-platform | **Date**: 2026-06-01

## Existing Entities Used (No Schema Changes)

### `port_allocations` (existing)

Key column used by the platform proxy:

| Column | Type | Description |
|---|---|---|
| `instanceRef` | text | Project reference (unique identifier) |
| `portKong` | integer | Kong gateway port — the single routing key for all per-project proxying |
| `portStudio` | integer | **Unused after this feature** — column left in place, allocation stops for new projects |

No migrations required. `portStudio` is left in the table (not dropped) to avoid a breaking migration on existing rows.

### `instances` (existing)

| Column | Type | Description |
|---|---|---|
| `ref` | text | Project reference — used to validate that a proxy target exists |
| `state` | enum | Instance lifecycle state — proxy returns 503 if state is `PAUSED` or `REMOVED` |

## Proxy Routing Logic (not persisted)

The platform proxy is stateless — it resolves `ref → portKong` at request time from `port_allocations`. No new tables or columns.

```
Request: GET /platform/pg-meta/<ref>/tables
  → SELECT portKong FROM port_allocations WHERE instanceRef = <ref>
  → 404 if not found
  → Forward to http://localhost:<portKong>/pg-meta/v0/tables
```

## State Transitions

No new state machine. The proxy respects the existing instance `state`:
- `ACTIVE_HEALTHY` / `ACTIVE_UNHEALTHY` → proxy to Kong
- `PAUSED` → return 503 with `{ error: "Project is paused" }`
- `REMOVED` / not found → return 404
