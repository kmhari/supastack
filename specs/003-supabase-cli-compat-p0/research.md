# Phase 0 Research: Supabase CLI Compatibility — P0

**Feature**: `003-supabase-cli-compat-p0` | **Date**: 2026-05-22 | **Sources**: empirical CLI trace; `/tmp/supabase-cli` (upstream v2.72.7 source); existing selfbase code

Every decision below has been emitted from either a direct grep of the upstream CLI source or an HTTP trace against an unmodified `supabase` binary. Where a question is still empirically open, it's marked **PENDING-TRACE** and points at the active background trace agent that's resolving it.

---

## R-001 — PAT token format and storage

**Decision**: Emit `sbp_<40 lowercase hex chars>` as the plaintext token. Continue storing **SHA-256 of plaintext** in `apiTokens.tokenSha256` (already the case). Add a small `prefix` column to the table (`text NOT NULL`, the first 12 chars of the plaintext, e.g. `sbp_e4cebad5`) so the dashboard's token list can display a stable, non-reversible label per token.

**Rationale**: The upstream CLI hard-validates tokens with `^sbp_(oauth_)?[a-f0-9]{40}$` in `apps/cli-go/internal/utils/access_token.go:16`. Tokens that don't match never enter the keyring and never hit the wire. We already had a `sb_<hex64>` format from selfbase's pre-CLI lineage; we're swapping the prefix and shortening the random portion to fit. 20 bytes of entropy is still 160 bits — far above any meaningful collision/guess threshold — so the security posture is unchanged. SHA-256 at-rest matches our existing schema; no migration of hashing logic.

**Alternatives considered**:
- *Keep `sb_<hex64>` and reject for the CLI*: rules out the entire feature.
- *Encrypt the plaintext at rest instead of hashing*: needlessly weaker (compromise of master key + DB reveals tokens). Hashing is the right primitive for opaque bearer tokens — the same primitive the upstream cloud uses.
- *Store the token prefix in a derived view*: adds query complexity for zero gain. A `prefix` column is the simpler choice.

**Action items**:
- Update `apps/api/src/services/api-tokens.ts:mintApiToken` — change `sb_${randomBytes(32).toString('hex')}` to `sbp_${randomBytes(20).toString('hex')}`.
- Migration: add `prefix` column to `apiTokens`, backfill from any existing rows (NULL where unknown — existing rows pre-date this feature and are dashboard-only, never used by the CLI, so a NULL prefix is acceptable and the dashboard will render them as `(legacy)`).
- Dashboard `SettingsTokens.tsx`: update the create-token modal copy to mention "Use this token with the Supabase CLI" and render the prefix in the list view.

---

## R-002 — Wire format the CLI sends to deploy (RESOLVED via trace + runtime experiment)

**Decision (revised twice — current version is final for P0)**: Implement **both** of the CLI's deploy paths in P0. The eszip-via-Docker path is the canonical UX (matches stock `supabase functions deploy` with no extra flags) and the `--use-api` path is a documented fallback for environments without Docker (CI runners, airgapped boxes). Both paths land on the same per-instance volume; the per-instance runtime detects which form is present (`bundle.eszip` vs source files) and serves accordingly.

**The first revision of this decision** (deferring eszip to P1) was based on a cost estimate that turned out to be wrong — the runtime image already ships first-class eszip support that we missed in the initial source-read. See `experiments/eszip-runtime-loading.md` for the empirical proof: a clean stage-3 test on the production VM, the runtime detecting a per-function eszip in a lazy-loading main router via `EdgeRuntime.userWorkers.create({ maybeEszip, maybeEntrypoint })`, serving live requests with no patches. Revised cost for eszip support is ~1 day, not 5.

**Trace verification for the `--use-api` path** (`/tmp/sb-deploy-trace-report.md`, captured against unmodified upstream `supabase` v2.72.7 with `--use-api`):

- **Endpoint** per single-function deploy: `POST /v1/projects/<ref>/functions/deploy?slug=<name>`
- **Transfer-Encoding: chunked** (no Content-Length) — backend MUST support chunked-multipart, not just buffered. `@fastify/multipart` does.
- **Content-Type**: `multipart/form-data; boundary=<60 hex chars>`
- **Body structure**:
  - One `metadata` part — JSON `{ entrypoint_path, import_map_path, name, static_patterns, verify_jwt }`. `import_map_path` is `""` (not omitted) when absent.
  - One or more `file` parts (same form name, repeated) — each with `filename="<relative-path>"`, `Content-Type: application/octet-stream`, body is **raw UTF-8 file bytes**.

**Trace verification for the eszip path** (source-read of `apps/cli-go/pkg/function/batch.go` + the upstream OpenAPI spec — not run against our stub server because Docker wasn't available on the trace host; the runtime experiment validates the receiving side):

- **Endpoint**: `POST /v1/projects/<ref>/functions?slug=<s>&name=<s>&verify_jwt=<bool>&import_map_path=<path>&entrypoint_path=<path>&ezbr_sha256=<hex>` for create, `PATCH /v1/projects/<ref>/functions/<slug>` (same query params) for update.
- **Preflight**: `GET /v1/projects/<ref>/functions` to compare `ezbr_sha256` and skip if unchanged.
- **Body**: raw eszip bytes (no multipart wrapper). `Content-Type: application/vnd.denoland.eszip`. Chunked transfer.
- **Eszip format**: `ESZIP2.3` magic header (current at the time of the experiment), produced by the runtime image's own `bundle` subcommand. The same image consumes it via the `EdgeRuntime.userWorkers.create({ maybeEszip })` API.

**Common to both paths**:

- **Headers**:
  - `Authorization: Bearer sbp_<40 hex>`
  - `User-Agent: SupabaseCLI/<version>` (literal `SupabaseCLI/2.72.7`, no space)
  - `Accept-Encoding: gzip`
- **Expected response**: `201 application/json` with `DeployFunctionResponse` (POST) or `200` (PATCH). Required fields: `{ id, slug, name, version, status: "ACTIVE" }`. Optional but recommended: `created_at` (int64 ms), `updated_at`, `verify_jwt`, `entrypoint_path`, `ezbr_sha256`, `import_map`, `import_map_path`.
- **Multi-function deploy** (multiple functions in one `supabase functions deploy`): N parallel POSTs, then a single `PUT /v1/projects/<ref>/functions` with `BulkUpdateFunctionBody`. Single-function deploy skips the bulk PUT.

**Storage layout per instance** (after either path completes):

```
/var/selfbase/instances/<ref>/volumes/functions/
├── main/index.ts            # router, ships from supabase-template, eszip-aware (see below)
├── <slug>/
│   ├── bundle.eszip         # iff deployed via eszip path
│   ├── meta.json            # always: { entrypoint, verify_jwt, ezbr_sha256, source_path }
│   └── <source files>       # iff deployed via --use-api path (index.ts, lib/*, etc.)
```

**Main router**: the per-instance `main/index.ts` detects which form is present (`bundle.eszip` first, fall through to `servicePath`) and dispatches accordingly via `EdgeRuntime.userWorkers.create({ maybeEszip, maybeEntrypoint, ... })` with `maybeEszip` set iff the eszip is on disk. ~15 added lines vs. the existing router; shipped through the normal `infra/supabase-template/volumes/functions/main/index.ts` update path.

**Rationale for shipping both**:

1. **Cloud-parity UX.** Stock `supabase functions deploy` works without flags. Onboarding docs match the cloud verbatim.
2. **Cost of adding the eszip path is ~1 day** (per the experiment): one route handler that accepts the raw body and writes it to disk; one ~15-line update to the main router; one template ship. Compared to ~1 week we'd save in support-thread churn over the lifetime of the deployment, it's an obvious trade.
3. **`--use-api` remains useful and free.** Already implemented in the plan for the Docker-less case. Backend code is shared (same restart logic, same DB rows, same audit log) — only the body-parsing branch differs.
4. **`ezbr_sha256` skip-no-change**. The eszip path lets the CLI skip an upload if the content hasn't changed; the `--use-api` path doesn't get this optimization for free. Cloud parity on this matters for fast iteration.

**Alternatives considered**:

- *Ship eszip-only*: would force Docker on every developer machine and break CI use-cases. Reject.
- *Ship `--use-api`-only* (the previous decision): forces every user to know about and pass a non-default flag; UX regression vs cloud. Reject given the cost dropped.
- *Decode eszip server-side back to source files*: needless intermediate step. The runtime handles eszip natively (experiment Stage 2 + 3). Reject.

**Action items**:

- `apps/api/src/services/function-deploy.ts`:
  - Branch on `Content-Type`: `multipart/form-data` → existing `--use-api` parser; `application/vnd.denoland.eszip` → stream raw body to `bundle.eszip` in the staging dir.
  - Both branches converge on: validate metadata, compute `ezbr_sha256`, atomic-move staging into per-instance volume, restart container, DB upsert, audit row.
  - Eszip metadata comes from query string (the CLI sends `entrypoint_path`, `verify_jwt`, `import_map_path`, `ezbr_sha256`, `name`, `slug`); write all of it into `<slug>/meta.json` for the main router to consume.

- `apps/api/src/routes/management/functions.ts`:
  - `POST /v1/projects/:ref/functions/deploy` (multipart) — `--use-api` path.
  - `POST /v1/projects/:ref/functions` (eszip body) — create on the canonical path.
  - `PATCH /v1/projects/:ref/functions/:slug` (eszip body) — update on the canonical path.
  - `PUT /v1/projects/:ref/functions` (JSON bulk-update body) — multi-deploy finalize.
  - `GET /v1/projects/:ref/functions` — list including `ezbr_sha256` so the CLI's skip-no-change check works.
  - `GET /v1/projects/:ref/functions/:slug/body` — download.
  - `DELETE /v1/projects/:ref/functions/:slug` — delete.

- `infra/supabase-template/volumes/functions/main/index.ts`:
  - Add ~15 lines: read `<slug>/meta.json` if present, read `<slug>/bundle.eszip` if present, pass `maybeEszip` + `maybeEntrypoint` to `EdgeRuntime.userWorkers.create()`. Fall back to `servicePath`-driven loading when no eszip is present.

- **Connect-CLI dashboard page** copy: canonical command is `supabase functions deploy hello`. `--use-api` shown as a footnote: *"On systems without Docker, append `--use-api` to the command."*

**Trace verification** (`/tmp/sb-deploy-trace-report.md`, captured against unmodified upstream `supabase` v2.72.7 with `--use-api`):

- **Single endpoint** per single-function deploy: `POST /v1/projects/<ref>/functions/deploy?slug=<name>`
- **Transfer-Encoding: chunked** (no Content-Length) — the backend MUST support chunked-multipart, not just buffered. `@fastify/multipart` does.
- **Content-Type**: `multipart/form-data; boundary=<60 hex chars>`
- **Body structure**:
  - One `metadata` part — JSON `{ entrypoint_path, import_map_path, name, static_patterns, verify_jwt }`. `import_map_path` is `""` (not omitted) when absent.
  - One or more `file` parts (same form name, repeated) — each with `filename="<relative-path>"`, `Content-Type: application/octet-stream`, body is **raw UTF-8 file bytes**.
- **Headers**:
  - `Authorization: Bearer sbp_<40 hex>`
  - `User-Agent: SupabaseCLI/<version>` (literal `SupabaseCLI/2.72.7`, no space)
  - `Accept-Encoding: gzip` (response gzip optional)
- **Expected response**: `201 application/json` with `DeployFunctionResponse`. Required fields: `{ id, slug, name, version, status: "ACTIVE" }`. Optional but recommended: `created_at` (int64 ms), `updated_at`, `verify_jwt`, `entrypoint_path`, `ezbr_sha256`, `import_map`, `import_map_path`.
- **Multi-function deploy** (multiple functions in one `supabase functions deploy` invocation): N parallel POSTs to `/v1/projects/<ref>/functions/deploy?slug=<each>&bundleOnly=true`, then a single `PUT /v1/projects/<ref>/functions` with a `BulkUpdateFunctionBody` JSON array. **Single-function deploy skips the bulk PUT**. P0 implements both; the bulk PUT is a thin no-op-ish endpoint that just returns the array we already stored.

**Rationale**: This is a strictly better outcome than the eszip path I'd preliminarily picked:

1. **Aligns with the runtime model we already have.** Files in directories under `volumes/functions/<slug>/` → runtime serves them. No new loader, no new flag, no eszip-loading experiments.
2. **No server-side bundling required.** Deno+esbuild stays on the developer's machine (where it belongs) for the eszip path, but the API path skips bundling entirely and ships raw source.
3. **Smaller blast radius for the deploy SLO budget (SC-003: 15s).** Server side becomes: parse multipart → write N small files → restart container. No bundle-decode step.
4. **Trivially supports import maps, static assets, multi-file functions.** Every `file` part is just a relative path + bytes — we write what we receive.

**Alternatives considered (and rejected for P0)**:

- *Implement the eszip path as P0*: requires either (a) confirming `supabase/edge-runtime:v1.71.2` can load `.eszip` files via its existing `main` router (untested), or (b) decoding eszip server-side back to source files (we'd vendor a Go-or-Rust eszip decoder, a non-trivial dependency for the P0 blast radius). Defer to P1.
- *Implement BOTH paths in P0*: doubles the surface area for the same end-state. Pick the simpler one first; ship.
- *Reject `--use-api` and force users to install Docker for bundling*: works against the user's reason for asking — `selfbase` users may be on stripped CI runners without Docker. Doesn't fly.

**Action items**:

- `apps/api/src/services/function-deploy.ts`:
  - Accept multipart at `POST /v1/projects/:ref/functions/deploy?slug=<slug>`. Stream every `file` part to `/tmp/selfbase-uploads/<request-id>/<filename>` (paths preserve relative structure with the upload root as parent).
  - Parse `metadata` part as JSON, validate with Zod (`.passthrough()` per R-010).
  - On success of all parts, atomically `mv` the upload directory into `/var/selfbase/instances/<ref>/volumes/functions/<slug>/` (replacing the prior version if any). Take a backup snapshot of the prior version first for rollback.
  - Trigger `dockerControl.restart('selfbase-<ref>-functions-1')` and `waitHealthy` (5s budget per R-003).
  - Insert/update the `project_functions` row (per data-model.md) inside the same DB transaction that wraps the file-mv. Roll back both on restart failure.
  - Respond `201` with the `DeployFunctionResponse` shape (required fields plus `verify_jwt`, `entrypoint_path`, `created_at`, `updated_at` for skip-no-change support; `ezbr_sha256` from the bundle's SHA256).

- `apps/api/src/routes/management/functions.ts`:
  - Mount `POST /v1/projects/:ref/functions/deploy` calling the service above.
  - Mount `PUT /v1/projects/:ref/functions` (bulk update) — accept a `BulkUpdateFunctionBody` array, return it back unchanged (with our canonical fields) since we already stored each function in the per-function POST.
  - Mount `GET /v1/projects/:ref/functions`, `GET .../functions/:slug/body`, `DELETE .../functions/:slug` for list/download/delete.

- **For the eszip path (out of P0)**: return 501 from `POST /v1/projects/:ref/functions` and `PATCH /v1/projects/:ref/functions/:slug` with content-type `application/vnd.denoland.eszip`. The error envelope identifies it as "Selfbase requires `--use-api` for function deploys in this version."

- **Connect-CLI dashboard page** copy: include `--use-api` in the example invocation. Make it part of the canonical command users copy.

---

## R-003 — Container reload mechanism for new/changed functions

**Decision**: Trigger a **graceful container restart** of the per-instance `functions` container after every successful deploy/delete. Use the existing `@selfbase/docker-control` dockerode wrapper. Restart is initiated synchronously from inside the deploy request handler, and the handler does not return success to the CLI until the container reports healthy. Hard budget: 5 seconds (with a 2-second typical observed).

**Rationale**: The upstream self-hosted docs explicitly recommend `docker compose restart functions --no-deps` as the deploy reload step. The runtime supports this — its boot is fast (~1-2s typical). The container ships no documented HMR/SIGHUP API, and probing for one is fragile (we'd be relying on un-released runtime behavior). Restart is the boring, supported, documented path.

The 5s budget plus 1-2s observed leaves 8-12s under our 15s first-deploy SLO (SC-003) for everything else: CLI bundling on the developer's machine, multipart upload, disk write, and the first cold-start request after restart.

**Alternatives considered**:
- *SIGHUP / SIGUSR2 to ask the runtime to re-scan*: nothing in the runtime documents this; even if it worked today it would be unreliable across runtime versions.
- *Run the runtime in a watch mode that auto-reloads when files change*: `supabase/edge-runtime` does not document a watch flag for production; live-reload exists only in `supabase functions serve` (local dev). Bringing it to production would mean patching the image — outside our P0 scope.
- *Use a separate "deploy worker" process to manage the restart*: unnecessary indirection for a sub-5s operation. The Fastify request handler can do this synchronously.

**Action items**:
- `function-deploy.ts`: after writing files, call `dockerControl.restart('selfbase-<ref>-functions-1')` and `dockerControl.waitHealthy(...)` with a 5s timeout.
- Failure path: if the restart times out or the container becomes unhealthy, roll back the file write (move the new files aside and restore the prior `.eszip` if it existed), restart again, and return 500 with a deploy-rolled-back error envelope.

---

## R-004 — Secret propagation without function redeploy (FR-014, FR-018, SC-005)

**Decision**: Write secrets as plain `KEY=value` lines into the per-instance `.env` file at `/var/selfbase/instances/<ref>/.env`, then **restart the `functions` container only** (not the entire stack) so the runtime picks up the new env. Encrypt the same values at rest in the control-plane DB (`project_secrets` table, master-key-encrypted blob) so the dashboard can show the redacted list and we can rebuild the `.env` after disaster recovery.

**Rationale**: The edge-runtime container is configured via Docker Compose's `environment:` section, which means env vars are injected from `.env` substitution at container creation time. There is no documented way to add env vars to a running Deno process. Restart is the only path.

Restarting only the `functions` container (not the whole stack) is in-budget — the spec allows ≤5s (SC-005) and an isolated restart is ~1-2s. Other per-instance services (kong, db, auth, etc.) are unaffected; existing function invocations in flight against old envs are interrupted, which is acceptable because the call site immediately retried-on-failure works (every Supabase client SDK does this) and the propagation budget already implies brief disruption.

**Alternatives considered**:
- *Use the runtime's `Deno.env.set` from inside the running process via a side-channel*: doesn't exist; the runtime sandboxes envs.
- *Store secrets in Vault / pg_sodium and have functions read them at runtime*: pivots the model away from the CLI's assumption that secrets are just environment variables; would break SDK examples and developer ergonomics. Reject — the spec (FR-018) demands env-style access.
- *Live-mount a tmpfs-backed env file and signal the runtime to re-read*: same untested-runtime-behavior problem as R-003's SIGHUP alternative.

**Action items**:
- `secret-store.ts`: `list(ref)` returns name + redacted indicator; `setMany(ref, entries)` updates `.env` and DB atomically, then triggers a single container restart; `deleteMany(ref, names)` likewise.
- Use a file-lock (or a per-instance Redis lock with a short TTL) around the `.env` edit to prevent concurrent CLI invocations from racing each other.
- Bundle multiple secret operations from a single CLI call into a single restart — the CLI sends one HTTP request for `secrets set FOO=1 BAR=2`, not two.

---

## R-005 — Reserved secret names (FR-019)

**Decision**: Maintain an in-code allowlist-by-rejection: any secret name that matches one of the values selfbase already writes into the per-instance `.env` is refused. Concretely (verified against `infra/supabase-template/docker-compose.yml`):

```
ANON_KEY, SERVICE_ROLE_KEY, JWT_SECRET, SUPABASE_URL, SUPABASE_PUBLIC_URL,
SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL,
SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEYS,
SUPABASE_SECRET_KEYS, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_PORT,
POSTGRES_DB, VERIFY_JWT, FUNCTIONS_VERIFY_JWT, DASHBOARD_USERNAME,
DASHBOARD_PASSWORD, SECRET_KEY_BASE, VAULT_ENC_KEY, LOGFLARE_PUBLIC_ACCESS_TOKEN,
LOGFLARE_PRIVATE_ACCESS_TOKEN, PG_META_CRYPTO_KEY
```

Plus a regex guard: secret names must match `^[A-Z][A-Z0-9_]{0,63}$` (POSIX env-var convention, 64 chars max, must start with a letter). This catches casing typos before they hit the runtime.

**Rationale**: These are the variables the runtime depends on for its own operation; overwriting any of them risks crashing the function container or, worse, silently substituting bogus credentials. The list is short, finite, and reviewable. We choose allowlist-by-rejection over silent shadowing because the spec (FR-019) demands explicit refusal.

**Alternatives considered**:
- *Namespace-prefix every user secret (e.g., `USER_FOO`)*: violates upstream CLI compatibility — the cloud doesn't do this and users would have to read selfbase-specific docs to translate names. Reject.
- *Allow overwrites and trust the user*: doesn't survive contact with users who name a secret `JWT_SECRET` thinking they're configuring their own JWT lib. The runtime crash that results is painful and inscrutable.

**Action items**:
- Constants live in `apps/api/src/services/secret-store.ts:RESERVED_SECRET_NAMES`.
- API returns a `400` with code `reserved_name`, naming the conflict (the response shape is the cloud-API error envelope — see contracts/error-envelope.md).

---

## R-006 — Dual-mode auth on the management surface

**Decision**: Mount the new `/v1/*` route group behind the existing `auth.ts` preHandler unchanged. The preHandler already supports both session-cookie auth and `Authorization: Bearer <token>` auth. Bearer-token requests look up `apiTokens` by SHA-256 hash and populate `request.user`. The new routes simply require `request.user` to be set; they don't care which mechanism set it.

**Rationale**: This is a single-codepath solution to a problem the codebase already solved. The only addition is that the new `/v1/*` routes are not gated by the dashboard's RBAC plugin — they're per-user, not per-org — but auth.ts already exposes the user id, so that's a route-level concern.

One catch: the existing auth.ts grants tokens the user's effective role at lookup time, which means a PAT minted by a user who later loses access to an instance still has access. This is consistent with cloud Supabase's PAT semantics (revocation is explicit, not automatic) and is documented in the spec as acceptable. **No change needed for P0.**

**Alternatives considered**:
- *Create a separate management-API-only middleware*: duplicates code, drifts.
- *Restrict bearer tokens to the new management API and exclude them from the dashboard `/api/v1/*` routes*: an artificial restriction that buys nothing.

**Action items**:
- Verify in `auth.ts` that the bearer path doesn't reject if no session is also present (it currently doesn't — confirmed).
- Add a route-level check in management routes: `if (!request.user) return reply.code(401).send(unauthorizedEnvelope)`.

---

## R-007 — Multipart body parsing

**Decision**: Add `@fastify/multipart` as a backend dependency, configured with a 50 MB hard limit per part and a 5-file max. Stream the file part to a tempfile under `/tmp/selfbase-uploads/` (the api container's tmpfs), then atomically move it to the per-instance volume only after the metadata part has parsed cleanly.

**Rationale**: Standard Fastify pattern. Streaming-to-tempfile means we never hold a 50 MB buffer in memory, atomic move means partial uploads never leave a corrupt eszip in the runtime's load path, and the 50 MB cap protects the disk against a malicious PAT trying to fill `/var/selfbase`.

**Alternatives considered**:
- *Use Busboy directly*: more code for the same outcome. `@fastify/multipart` wraps Busboy under the hood.
- *Accept a JSON-with-base64 body instead of multipart*: not what the CLI sends. Reject.

**Action items**:
- `apps/api/package.json`: add `@fastify/multipart`.
- Register the plugin in `apps/api/src/server.ts` scoped to the management routes only (don't expose multipart to the dashboard surface).

---

## R-008 — Error envelope shape

**Decision**: Match the cloud Management API's error envelope: `{ "message": string, "code"?: string, "details"?: object }` with appropriate HTTP status codes (`400` validation, `401` unauthorized, `403` forbidden, `404` not found, `409` conflict, `413` payload too large, `422` semantic validation, `500` server, `501` not implemented). Document the exact shape in `contracts/error-envelope.md`.

**Rationale**: The CLI's generated client deserializes errors by reading `message` first; missing field crashes the parser with a Go reflect error (we saw this in our earlier trace: `json: cannot unmarshal object into Go value of type []api.SecretResponse`). The cloud envelope is minimal and well-documented in their OpenAPI spec.

**Alternatives considered**:
- *Use selfbase's existing dashboard error envelope (`{ "error": { "code", "message" } }`)*: not parseable by the CLI; would force every CLI consumer to see "unexpected error retrieving X" generic messages.
- *Return RFC 7807 problem-details*: also not what the CLI parses. Reject.

**Action items**:
- New plugin `apps/api/src/plugins/mgmt-api-errors.ts` that sets a custom error handler for the management route group, transforming Fastify validation errors and uncaught exceptions into the cloud envelope.

---

## R-009 — Connect-CLI dashboard helper endpoints

**Decision**: Add two helper endpoints under `/api/v1/cli/` (selfbase's internal dashboard surface, not the new `/v1/` management surface):

- `GET /api/v1/cli/profile.toml` — returns the TOML snippet pre-filled with the deployment's `api_url` (`https://api.<apex>`), `dashboard_url`, and `project_host` (`<apex>`). Content-Type `text/plain`. Auth: session cookie required.
- `POST /api/v1/cli/mint-token` — convenience endpoint that calls `mintApiToken` with a default label like `"CLI on <hostname>"` and returns `{ token, label }`. Same as creating a token through the Tokens UI, but one click; the dashboard's Connect-CLI page calls it.

**Rationale**: The Connect-CLI page needs both a downloadable TOML and a "create a CLI token now" button. We could have the UI build the TOML client-side from session data, but having the server emit it is one source of truth and trivially supports future fields (e.g., a `pooler_host` once we add the L4 Postgres proxy for `db push`).

**Alternatives considered**:
- *Have the dashboard reuse the existing Tokens API for minting*: works but means the Connect-CLI page is two-step (open Tokens tab → create token → return). One-click is the right UX for first-time setup.
- *Pre-mint a token on first dashboard load*: surprises users with credentials they didn't ask for.

**Action items**:
- New route file `apps/api/src/routes/connect-cli.ts`.
- TOML template lives inline in the route handler; no template engine needed for ~6 lines.

---

## R-010 — Compatibility with future upstream CLI changes (FR-023)

**Decision**: Use **permissive request parsing** (Zod `.passthrough()` on every request body schema in `packages/shared/src/schemas.ts`) so unknown new fields the CLI starts sending are ignored, not rejected. Use **conservative response emission**: omit (don't null) every optional field selfbase doesn't model. Don't add fields to responses unless the CLI is observed to need them.

**Rationale**: The upstream CLI evolves on a release cadence we don't control. The CLI's generated client uses `json:"…,omitempty"` on most struct fields and tolerates extra fields in JSON responses (Go's default `encoding/json` behavior). The combination of permissive in / conservative out is the standard tactic for clients you don't own.

We accept that some new fields (e.g., a `signing_key` field returned by `GET /v1/projects/:ref/api-keys`) may eventually be required for new commands to work. That's a future-work problem; the deal is selfbase tracks the CLI and adds fields as the CLI starts requiring them, not preemptively.

**Alternatives considered**:
- *Strict request validation*: would break the moment the CLI adds an optional field.
- *Return every field the upstream cloud returns, with stub values*: invites the CLI to display or use bogus data.

**Action items**:
- Zod schemas in `packages/shared/src/schemas.ts` for every P0 endpoint, with `.passthrough()` on request bodies.
- Document the policy in `contracts/management-api.yaml` as an `x-selfbase-compat-policy` extension.

---

## R-011 — Test strategy for CLI compatibility

**Decision**: Three tiers.

1. **Unit tests** (`vitest`) — pure functions: token generator format, eszip header parse, reserved-name guard, env-file editing, schema-shape mapping. Fast, no I/O.

2. **Integration tests** (`vitest`) — full Fastify app under test, with a real Postgres (`pg-mem` or testcontainers, decide at implementation time), a fake docker-control (records calls instead of acting), and the multipart parser actually running. Asserts response shapes against the OpenAPI contract.

3. **E2E CLI test** (one script, opt-in) — `pnpm test:cli` brings up the api on a random port, mints a fake token, writes a profile pointing at `http://127.0.0.1:<port>`, then runs `SUPABASE_ACCESS_TOKEN=… supabase --profile … functions deploy hello` and asserts exit code 0 plus a curl to the function URL returns the expected body. Requires `supabase` binary in PATH and Docker running on the dev's machine (the CLI uses Docker for local bundling); CI runs this on a self-hosted runner that already has both.

**Rationale**: Tier 3 is the only thing that catches actual CLI-shape drift. Tier 2 catches our schema mistakes. Tier 1 catches everything else cheaply. Tier 3 stays opt-in (not in PR-time CI) because the bundling Docker pull is heavy and flaky on cloud CI; we'd rather have a fast green-light loop and a separate slower compatibility job that gates merges to main once a day.

**Alternatives considered**:
- *No E2E*: leaves the whole compatibility story untested in selfbase's repo. Reject — this is the spec's primary deliverable.
- *Mock the CLI in our tests*: defeats the purpose.

**Action items**:
- `apps/api/tests/integration/management-api/*.test.ts` for tier 2.
- `tests/cli-e2e/deploy-hello.sh` plus `pnpm test:cli` script in root `package.json` for tier 3.
- Document the E2E expectations in `quickstart.md` so a human can run them too.

---

## Open items

All Phase-0 unknowns are resolved. The earlier PENDING-TRACE on multipart wire format closed with a positive result, and the eszip-loading question (originally deferred to P1) closed with a positive empirical result — see `experiments/eszip-runtime-loading.md`. Items below don't block P0 implementation but are worth tracking:

| Item | Why it doesn't block | When we'd revisit |
|---|---|---|
| Exact `entrypoint_path` URL form the CLI's bundler uses | Falls back to parsing the eszip's module listing (~50 LoC) if `maybeEntrypoint` is rejected | Implementation-phase if we see entrypoint rejections in integration tests |
| Whether the runtime supports any non-restart reload signal | P0 uses container restart (≤5s, in-budget) | Performance tuning post-launch if restart budget is tight |
| `Accept-Encoding: gzip` — should we gzip responses? | The CLI accepts but does not require gzipped responses | Optimization once we have telemetry on response sizes |
| Runtime version coupling | `supabase/edge-runtime:v1.71.2` exposes the eszip API we depend on. A future version could rename `maybeEszip`. | Pinned at the image-version level by our supabase-template; revisit on every runtime upgrade |

No NEEDS-CLARIFICATION markers remain in the spec.
