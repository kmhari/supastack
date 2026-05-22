# Wire format: function deploy

The upstream CLI has **two distinct deploy paths**. Selfbase implements both in P0:

| Path | Trigger | Body | Selfbase status |
|---|---|---|---|
| Eszip (default) | Docker running on the dev machine, no flag | Raw eszip bytes, `Content-Type: application/vnd.denoland.eszip` | §2 below — P0 |
| `--use-api` | User passes `--use-api` OR Docker is missing | Multipart with metadata + raw source files | §1 below — P0 |

Both paths converge on the same per-instance volume layout. The edge-runtime's main router detects which form is present (`bundle.eszip` vs source files) and loads accordingly via `EdgeRuntime.userWorkers.create()` — see `experiments/eszip-runtime-loading.md` for the runtime API and `infra/supabase-template/volumes/functions/main/index.ts` for the router code (modified by T0xx in tasks.md).

---

## §1 — `--use-api` path

`POST /v1/projects/{ref}/functions/deploy`

Captured empirically against unmodified `supabase` CLI **v2.72.7** with `--use-api`.
Source-of-truth in upstream: `apps/cli-go/pkg/function/deploy.go:writeForm`.

## Request line

```
POST /v1/projects/<ref>/functions/deploy?slug=<slug>[&bundleOnly=true]
```

- `<ref>` — project reference (path segment matching `^[a-z0-9]{20,32}$`).
- `slug` query param — function identifier, required. Matches `^[a-z0-9][a-z0-9-]{0,47}$`.
- `bundleOnly=true` — present on the per-function step of a multi-function deploy. Selfbase treats it as advisory; behavior is identical.

## Headers

```
Host: api.<apex>
User-Agent: SupabaseCLI/<version>            # literal "SupabaseCLI/2.72.7", no space
Authorization: Bearer sbp_<40 hex>
Content-Type: multipart/form-data; boundary=<60 hex>
Transfer-Encoding: chunked
Accept-Encoding: gzip
```

**Critical detail**: `Transfer-Encoding: chunked` with NO `Content-Length`. The
body is streamed by Go's `io.Pipe` in the CLI; the backend MUST read it as
chunked, not buffered.

## Body — multipart/form-data

Exactly N+1 parts: one `metadata` part, then one or more `file` parts (same form
name, repeated for each file in the function).

### Part 0 — `metadata`

```
Content-Disposition: form-data; name="metadata"
```

(No explicit Content-Type — Go's `CreateFormField` omits it.)

Body is JSON (no trailing whitespace requirements):

```json
{
  "entrypoint_path": "supabase/functions/<slug>/index.ts",
  "import_map_path": "",
  "name": "<slug>",
  "static_patterns": [],
  "verify_jwt": true
}
```

Field semantics (from `FunctionDeployMetadata` in `pkg/function/api.go:17`):

| Field             | Type     | Notes |
|-------------------|----------|-------|
| `entrypoint_path` | string   | Always present, POSIX slashes, relative to cwd. Must match one of the `file` parts' filenames. |
| `import_map_path` | string   | **Sent as `""` (not omitted) when no import map.** The Go encoder writes the field because the pointer is non-nil. |
| `name`            | string   | The function slug; should equal the `?slug=` query param. Validate consistency. |
| `static_patterns` | string[] | Glob patterns of additional non-source assets that the CLI included in the upload. |
| `verify_jwt`      | boolean  | Default true on the CLI side. Whether the runtime should verify JWT on incoming requests. |
| `sha256`          | string   | Set by the CLI **only on the eszip path** (`--use-docker`). Ignored on the API path. |

**Permissive parsing**: any field selfbase doesn't model should be ignored, not
rejected. New CLI versions may add fields.

### Part 1..N — `file` (repeated)

```
Content-Disposition: form-data; name="file"; filename="<relative path>"
Content-Type: application/octet-stream
```

Body: **raw bytes** of the file. UTF-8 source for `.ts`/`.js`, but the part is
treated as binary — the CLI sets `application/octet-stream` regardless of file
type and doesn't transform contents.

**Filename semantics**:
- POSIX-style, relative to cwd, e.g. `supabase/functions/hello/index.ts`.
- Windows backslashes are normalized to slashes by the CLI before send.
- Selfbase MUST preserve relative structure when writing to disk: strip the
  `supabase/functions/<slug>/` prefix and write the remainder under
  `/var/selfbase/instances/<ref>/volumes/functions/<slug>/`. Example:
  - Filename `supabase/functions/hello/index.ts` → disk `volumes/functions/hello/index.ts`
  - Filename `supabase/functions/hello/lib/util.ts` → disk `volumes/functions/hello/lib/util.ts`
  - Filename `supabase/functions/_shared/cors.ts` → disk `volumes/functions/_shared/cors.ts` (shared imports — note: the slug is `hello`, but the file is outside the slug directory; preserve it as-is)
- Reject any filename that escapes the working tree via `..` or absolute paths
  (`/var/selfbase` blast-radius hardening).

## Response

### Success — `201 Created`

```
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "id": "fn_<ref>_<slug>",
  "slug": "<slug>",
  "name": "<slug>",
  "version": 1,
  "status": "ACTIVE",
  "verify_jwt": true,
  "entrypoint_path": "supabase/functions/<slug>/index.ts",
  "import_map_path": null,
  "ezbr_sha256": "<sha256 of the bundle on disk>",
  "created_at": 1779438878848,
  "updated_at": 1779438878848
}
```

Required fields (CLI hard-rejects on missing): `id`, `slug`, `name`, `version`, `status`.
Recommended additional fields (used by skip-no-change logic on subsequent deploys):
`verify_jwt`, `entrypoint_path`, `ezbr_sha256`, `created_at`, `updated_at`.

`created_at` and `updated_at` are **Unix epoch milliseconds as int64**, not ISO 8601. This is a cloud-API convention specific to function endpoints.

`status` is one of `ACTIVE | REMOVED | THROTTLED`; selfbase only ever emits `ACTIVE` on this endpoint.

### Errors

All error responses use the envelope at `contracts/error-envelope.md`.

| Code | When |
|---|---|
| `400` | Malformed multipart, malformed metadata JSON, missing required fields. |
| `401` | Missing/expired/invalid PAT. |
| `404` | Project ref doesn't exist. |
| `413` | Bundle exceeds 50 MB hard cap (selfbase-configured). |
| `422` | Slug fails regex; `entrypoint_path` doesn't match any uploaded `file` part; file path escapes the working tree. |
| `500` | Disk write failed, container restart failed (in which case selfbase rolls back the file and the function remains at its prior version). |

## Implementation notes for selfbase (`--use-api` path)

1. **Streaming parse**. `@fastify/multipart` configured with `limits: { fileSize: 50 * 1024 * 1024, files: 100 }`.
2. **Stream files to tempdir**. `/tmp/selfbase-uploads/<request-id>/<filename>` mirroring the part's relative structure.
3. **Validate before move**. After all parts parsed, run the regex/path-escape checks; only then `mv` the staging tree into `/var/selfbase/instances/<ref>/volumes/functions/`.
4. **Backup prior version**. If `volumes/functions/<slug>/` exists, snapshot to a sibling `volumes/functions/.deploy-rollback/<slug>-<ts>/` before overwriting. Keep for one rollback cycle; the worker GCs after 60s.
5. **Restart trigger**. After the move + DB row insert/update, `dockerControl.restart('selfbase-<ref>-functions-1')` with `waitHealthy(5s)`.
6. **Rollback on restart failure**. Move the new files aside, restore the backup, restart again, return `500` with `code: deploy_rolled_back`.
7. **Compute `ezbr_sha256`**. SHA-256 of a stable concatenation of `(filename, contents)` pairs sorted by filename. Used to support the CLI's skip-no-change optimization on re-deploys.
8. **`created_at` / `updated_at`**. Emit `Date.now()` (milliseconds since epoch).
9. **Write `meta.json`** alongside the source files: `{ source_path: 'index.ts', entrypoint_path, verify_jwt, ezbr_sha256, deployed_by, deployed_at }`. The main router reads this to dispatch via `servicePath`-mode loading. Distinguishable from the eszip path by `source_path` ending in `.ts` instead of `.eszip`.

---

## §2 — Eszip path

The default flow when Docker is available on the developer's machine. The CLI bundles locally, then ships the raw eszip bytes to selfbase via two endpoint variants depending on whether the function exists.

### Sequence

1. CLI builds eszip locally via its `supabase/edge-runtime` Docker container (`bundle --entrypoint ... --output output.eszip`).
2. CLI calls `GET /v1/projects/{ref}/functions` to enumerate existing functions.
3. For each target function:
   - If absent → **`POST /v1/projects/{ref}/functions?slug=...&name=...&...`** with the eszip body.
   - If present → check `ezbr_sha256` against the locally-computed hash. Skip if equal; otherwise **`PATCH /v1/projects/{ref}/functions/{slug}?...`** with the eszip body.
4. If multiple functions deployed in this invocation → final **`PUT /v1/projects/{ref}/functions`** with `BulkUpdateFunctionBody` JSON.

### Request line (create)

```
POST /v1/projects/<ref>/functions?slug=<slug>&name=<slug>&verify_jwt=<bool>&import_map_path=<path>&entrypoint_path=<file://url>&ezbr_sha256=<hex>
```

### Request line (update)

```
PATCH /v1/projects/<ref>/functions/<slug>?verify_jwt=<bool>&import_map_path=<path>&entrypoint_path=<file://url>&ezbr_sha256=<hex>
```

### Headers

```
Host: api.<apex>
User-Agent: SupabaseCLI/<version>
Authorization: Bearer sbp_<40 hex>
Content-Type: application/vnd.denoland.eszip
Transfer-Encoding: chunked
Accept-Encoding: gzip
```

### Body

**Raw bytes** of the eszip file produced by the CLI. No multipart wrapper, no envelope. First 6 bytes are the magic header `ESZIP2` followed by a version byte (current at experiment time: `2.3`). Backend MUST consume as a raw stream — no JSON parse, no multipart parse.

The eszip is produced by the same `supabase/edge-runtime` binary that consumes it on the receiving side, so the format is guaranteed-compatible iff the CLI's bundler image version and our runtime image version are in the same compat range. The eszip format is stable across minor versions per the Deno team's commitment; breaking changes would be a major version bump.

### Query-param metadata (all paths)

| Param | Required on POST | Required on PATCH | Notes |
|---|---|---|---|
| `slug` | yes (path or query depending on endpoint) | path-only | Function identifier |
| `name` | yes | implied from slug | Display name; usually equals slug |
| `verify_jwt` | yes | optional | Boolean string `true`/`false` |
| `import_map_path` | yes (empty allowed) | optional | Sent as empty string when absent |
| `entrypoint_path` | yes | optional | `file://...` URL inside the eszip's module graph |
| `ezbr_sha256` | yes | yes | SHA-256 of the eszip bytes; used for skip-no-change |

### Response — `201 Created` (POST) / `200 OK` (PATCH)

Same `DeployFunctionResponse` shape as the `--use-api` path (§1). The eszip path additionally MUST set `ezbr_sha256` in the response (recomputed by selfbase from the bytes-on-disk) so the CLI can use it as the change-detection baseline on the next deploy.

### Implementation notes for selfbase (eszip path)

1. **Stream the raw body** directly to `/tmp/selfbase-uploads/<request-id>/bundle.eszip` — no multipart parsing. Cap at 50 MB via Fastify's `bodyLimit`. Use `application/vnd.denoland.eszip` and `application/octet-stream` as acceptable content-types (some CLI versions may send the latter).
2. **Validate the magic header** before persisting. Reject with `422` and `code: invalid_eszip` if the first bytes don't start with `ESZIP`.
3. **Validate `ezbr_sha256` query param** against the streamed bytes' actual SHA-256. Reject with `422` and `code: ezbr_mismatch` on mismatch (defensive — protects against truncated chunked uploads).
4. **Backup + atomic move + restart + rollback**: identical to §1's steps 4–6. The unit of replacement is `volumes/functions/<slug>/bundle.eszip` (single file) plus `volumes/functions/<slug>/meta.json` (single file). Existing source files in the directory are removed when transitioning from `--use-api` deploys to eszip deploys for the same slug.
5. **Write `meta.json`** as `{ source_path: 'bundle.eszip', entrypoint, verify_jwt, ezbr_sha256, deployed_by, deployed_at }`. The main router reads this to know `maybeEszip` is the path and `maybeEntrypoint` is the URL.
6. **Bulk-update PUT** (`PUT /v1/projects/{ref}/functions`): receives a JSON array of `BulkUpdateFunctionEntry`, returns `{functions: [...]}` echoing back the persisted state. No file I/O — the per-function POSTs already did it.
7. **Skip-no-change on GET**: `GET /v1/projects/{ref}/functions` MUST populate `ezbr_sha256` for every function so the CLI can compare and skip uploads.
