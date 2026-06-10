# Contracts — Feature 116 admin API (`/api/v1/admin/*`)

All endpoints: **read-only (GET)**, dashboard namespace (NOT `/v1/*`), require an authenticated session, and gate via `app.authorize(req, <action>)` (installation admin = `owner`/`administrator`). Non-admin / signed-out → `401`/`403`. Shapes are supastack-internal (not pinned to upstream Supabase).

## US2 — Fleet, health, system, logs

### `GET /api/v1/admin/fleet` — action `admin.console.read`
Installation-wide project list.
```jsonc
{ "projects": [
  { "ref": "ogql…", "name": "demo", "org": "Acme", "status": "running",
    "createdAt": "2026-06-08T…", "endpoints": { "api": "https://ogql….<apex>" } }
] }
```

### `GET /api/v1/admin/projects/:ref` — action `admin.console.read`
Per-project detail: services health, versions, db status (delegates to existing `/platform/projects/:ref/{services,service-versions,databases-statuses}`).
```jsonc
{ "ref": "ogql…", "status": "running",
  "services": [{ "name": "auth", "healthy": true, "version": "v2.186.0" }, …],
  "database": { "status": "ACTIVE_HEALTHY" } }
```

### `GET /api/v1/admin/system` — action `admin.console.read`
Control-plane health + version (from `control_plane_snapshots`).
```jsonc
{ "deployedCommit": "fa57afb", "capturedAt": "…",
  "components": [{ "container": "supastack-api-1", "health": "healthy", "status": "Up 44h", "image": "supastack/api:dev" }, …] }
```

### `GET /api/v1/admin/logs?source=<sel>&tail=N` — action `admin.console.read`
- `source=project:<ref>:<service>` → proxied via existing api→Kong→`logs.all` (fresh).
- `source=control-plane:<container>` → `control_plane_snapshots.log_tail` (~60s stale, redacted).
```jsonc
{ "source": "control-plane:supastack-api-1", "capturedAt": "…", "fresh": false,
  "lines": ["2026-06-10T… …", …] }
```

## US3 — Resources

### `GET /api/v1/admin/resources` — action `admin.resources.read`
Latest host totals + per-project usage + disk breakdown + avg footprint.
```jsonc
{ "capturedAt": "…",
  "host": { "cpuPct": 38.2, "memUsedBytes": …, "memLimitBytes": …,
            "disk": { "projectData": …, "backups": …, "other": …, "free": … } },
  "projects": [{ "ref": "ogql…", "cpuPct": 4.1, "memUsedBytes": …, "diskUsedBytes": … }],
  "avgProjectFootprint": { "memUsedBytes": …, "diskUsedBytes": … } }
```
> No "N more projects fit" number (FR-017). Empty state: `{ "capturedAt": null, "collecting": true }`.

### `GET /api/v1/admin/resources/:ref/trend?window=24h` — action `admin.resources.read`
Recent time-series for one project (for sparkline/trend).
```jsonc
{ "ref": "ogql…", "samples": [{ "t": "…", "cpuPct": …, "memUsedBytes": …, "diskUsedBytes": … }] }
```

## US4 — Queues

### `GET /api/v1/admin/queues` — action `admin.queues.read`
Per queue counts + redacted recent failures.
```jsonc
{ "queues": [
  { "name": "provision", "counts": { "waiting": 0, "active": 1, "failed": 2, "delayed": 0, "completed": 153 },
    "recentFailures": [
      { "id": "42", "name": "provision", "failedReason": "instance ogql… <redacted>", "failedAt": "…", "attemptsMade": 3 }
    ] }
] }
```
> `job.data` is never returned; `failedReason` is redacted.

## US5 — Cert / DNS / backups

### `GET /api/v1/admin/certs` — action `admin.certs.read`
```jsonc
{ "wildcard": { "apex": "supaviser.dev", "notAfter": "…", "daysLeft": 64, "renewalWarning": false },
  "perProject": [{ "ref": "ogql…", "notAfter": "…", "daysLeft": 70, "status": "issued" }],
  "dns": { "apexReady": true, "wildcardReady": true },
  "backups": { "totalStorageBytes": …,
               "perProject": [{ "ref": "ogql…", "lastBackupAt": "…", "sizeBytes": …, "outcome": "success" }] } }
```

## Cross-cutting contract rules

- Every endpoint MUST return cleanly (200 with empty arrays / `collecting`/`fresh:false` flags) when its source is empty/unavailable — never 500 (FR-030).
- Authorization is checked server-side on every call (FR-009); the client guard is UX-only.
- The RBAC matrix contract test MUST assert each new action is granted to `owner`+`administrator` and denied to `developer`+`read_only`.
