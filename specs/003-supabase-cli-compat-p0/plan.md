# Implementation Plan: Supabase CLI Compatibility — P0

**Branch**: `003-supabase-cli-compat-p0` | **Date**: 2026-05-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-supabase-cli-compat-p0/spec.md`

## Summary

Expose a strict, drift-resistant subset of Supabase's Management API (`/v1/projects/*`, `/v1/organizations`, `/v1/profile`) on the existing supastack backend at `https://api.<apex>/v1/...`, so that the unmodified upstream `supabase` CLI — selected by a one-file profile config — can authenticate with a supastack-issued PAT, link to per-instance projects, deploy edge functions, and manage runtime secrets. The wire format is pinned by the upstream CLI's generated client; supastack adapts to it. Approach is **filesystem + container restart** for function deploys (matching upstream's self-hosted recommendation) and **`.env`-injection + container restart** for secrets — no new long-running services.

The deploy backend supports **both** of the CLI's wire formats: the default eszip-via-Docker path (`POST /v1/projects/:ref/functions` with `Content-Type: application/vnd.denoland.eszip`) and the `--use-api` raw-source path (`POST /v1/projects/:ref/functions/deploy` with multipart). The per-instance edge-runtime's `main` router is updated (~15 added lines) to detect whichever form is on disk and dispatch via `EdgeRuntime.userWorkers.create({ maybeEszip, maybeEntrypoint })` for eszip-backed functions or via `servicePath`-based loading for raw-source functions. Empirical proof of viability is captured in `experiments/eszip-runtime-loading.md`.

PAT primitives already exist in the codebase and need a format change (`sb_<hex64>` → `sbp_<hex40>`) to match the CLI's hardcoded validation regex.

## Technical Context

**Language/Version**: TypeScript 5.x (Node 20 LTS for the api + worker; React 19 + Vite for the web app)

**Primary Dependencies**:

- Backend: Fastify 5, Drizzle ORM (Postgres node-pg driver), Redis (session store), dockerode (via `@supastack/docker-control`), `@supastack/crypto` for master-key-encrypted blobs
- Frontend: React 19, react-router 7, TanStack Query, shadcn-ui primitives on Tailwind v4, Sonner toasts
- New for this feature: a multipart parser (Fastify's built-in `@fastify/multipart` if not already present), and an eszip decoder (decision in research.md)

**Storage**:

- Control-plane Postgres (`supastack` DB) — adds three new tables for function metadata, deploy audit, and secret metadata; reuses existing `apiTokens`, `users`, `supabaseInstances`
- Per-instance host filesystem at `/var/supastack/instances/<ref>/volumes/functions/<slug>/` — already mounted into the api container at the same path
- Per-instance `.env` file at `/var/supastack/instances/<ref>/.env` — already exists and is the source of truth for runtime env vars
- Per-instance Postgres (each instance has its own) — not touched by this feature

**Testing**:

- Backend: vitest (workspace already configured), with `supertest`-style HTTP integration tests against an in-memory Fastify instance
- One end-to-end contract test that runs the real upstream `supabase` CLI binary against a locally-running api with a stub `apiTokens` row, mirroring the trace experiment that produced the spec. Skips when `SUPABASE_CLI_TEST=0` (off in CI by default; opt-in for local development; bundled as a manual `pnpm test:cli` script).

**Target Platform**: Linux x86_64 (production), macOS for development. The api container is a `node:20-slim` image with the docker socket and `/var/supastack` mounted in.

**Project Type**: Web service backend + web admin app, both in a pnpm monorepo. Adding routes/services/migrations under `apps/api/` and one new page (plus extending an existing one) under `apps/web/`.

**Performance Goals** (from spec SC-003 to SC-005):

- First-deploy budget: ≤15s end-to-end from CLI Enter → function answering its first request
- Repeat-deploy budget: ≤10s
- Secret propagation: ≤5s, no function redeploy required

Of those budgets, the api server's share is realistically ~2–4s (multipart parse + disk write + `docker restart`); the rest is CLI bundling (Deno+esbuild on the developer's machine) and edge-runtime cold start.

**Constraints**:

- The CLI's PAT regex `^sbp_(oauth_)?[a-f0-9]{40}$` is a hard external constraint — tokens that don't match never leave the user's machine.
- Response shapes (status codes, JSON field names, error envelopes) must be a strict subset of the upstream cloud Management API's contract. We don't innovate on shape — we conform.
- The api container has the docker socket mounted (`/var/run/docker.sock`) and `/var/supastack/instances` mounted at the same path. No new mounts required.
- No new container, no new daemon, no new long-running process. All P0 work lives inside the existing `apps/api` Fastify instance.
- The upstream CLI is updated frequently; supastack must NOT break when the CLI adds new optional fields to its requests or expects new optional fields in responses. Use permissive parsing (ignore unknown request fields) and conservative responses (omit unsupported fields rather than emit invalid stub values).

**Scale/Scope**:

- A single supastack deployment is expected to host on the order of 10–100 per-customer instances; each instance hosts on the order of 1–50 edge functions and 1–200 secrets. Per-deploy bundle size up to ~50 MB (Deno+npm graphs of typical functions land at 1–10 MB; we set a hard server-side cap of 50 MB to defend the disk).
- Management-API request volume is interactive (developer-driven), so peak concurrency is small — a few requests per second per deployment is generous. Optimize for correctness and shape-stability, not raw throughput.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`/Users/lord/Code/superbase/.specify/memory/constitution.md` contains only placeholder text — no principles have been ratified for this project. Constitution gates are therefore **vacuously satisfied**; the planner should treat the project's existing CLAUDE.md, `plan.md` (root engineering blueprint), and the prior two implemented feature specs (`001-supastack-supabase-platform`, `002-shadcn-tailwind-migration`) as the de-facto conventions to honor:

- Backend code lives under `apps/api/src/{routes,services,plugins}/`. Routes are file-per-resource Fastify modules registered in `server.ts`. Services are pure functions (no Fastify imports). DB access goes through Drizzle via `@supastack/db`.
- DB migrations are **idempotent** (per the user's standing instruction in `CLAUDE.md`).
- Encrypted-at-rest sensitive blobs use `@supastack/crypto`'s `encryptJson` + master key (per the existing `instance-secrets.ts` precedent).
- Per-instance container control happens through `@supastack/docker-control` (the existing dockerode wrapper) — no shell-out to `docker`.
- Frontend pages use shadcn primitives, Tailwind v4 utility classes, the custom-font stack from `apps/web/src/index.css`, and existing components (`Shell`, `PageHeader`, `Card`, `CardRow`, `InputWithCopy`) wherever possible.
- Tests live next to the code being tested (vitest workspace).

No deviations are anticipated. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/003-supabase-cli-compat-p0/
├── plan.md              # This file
├── research.md          # Phase 0 — open questions resolved with empirical/source evidence
├── data-model.md        # Phase 1 — entities, schema deltas, state transitions
├── quickstart.md        # Phase 1 — verification walkthrough (the spec's Acceptance Scenarios as runnable steps)
├── contracts/
│   ├── management-api.yaml      # OpenAPI 3.1 of the P0 endpoint subset (auto-validatable against the cloud schema)
│   ├── functions-deploy.md      # Wire-format notes for the multipart deploy upload (eszip + manifest)
│   └── error-envelope.md        # Error shape supastack must return for the CLI to parse
└── checklists/
    └── requirements.md          # (from specify phase)
```

### Source Code (repository root)

```text
apps/
├── api/                                              # Existing Fastify backend
│   └── src/
│       ├── server.ts                                 # MODIFY — register new mgmt-api route group
│       ├── plugins/
│       │   ├── auth.ts                               # MODIFY — already supports bearer tokens; accept the new sbp_ prefix
│       │   └── mgmt-api-errors.ts                    # NEW — Fastify error formatter that emits the cloud-shape error envelope
│       ├── routes/
│       │   ├── management/                           # NEW directory — every file mounts at /v1/...
│       │   │   ├── profile.ts                        # GET /v1/profile
│       │   │   ├── organizations.ts                  # GET /v1/organizations
│       │   │   ├── projects.ts                       # GET /v1/projects, GET /v1/projects/:ref
│       │   │   ├── api-keys.ts                       # GET /v1/projects/:ref/api-keys
│       │   │   ├── functions.ts                      # GET /v1/projects/:ref/functions; PUT bulk; POST .../deploy (multipart, --use-api);
│       │   │   │                                     # POST .../functions (eszip body, default); PATCH .../:slug (eszip body, default);
│       │   │   │                                     # GET/DELETE .../:slug, GET .../:slug/body
│       │   │   ├── secrets.ts                        # GET/POST/DELETE /v1/projects/:ref/secrets
│       │   │   └── not-implemented.ts                # Catch-all under /v1 that emits the structured "not implemented for this deployment" error (FR-024)
│       │   └── connect-cli.ts                        # NEW — dashboard helper: GET /api/v1/cli/profile.toml (signed snippet), POST /api/v1/cli/mint-token
│       └── services/
│           ├── api-tokens.ts                         # MODIFY — change format to `sbp_<hex40>`
│           ├── function-deploy.ts                    # NEW — body-shape dispatcher (multipart OR raw eszip) + disk writer + container reload + rollback
│           ├── function-store.ts                     # NEW — read/list/delete functions on per-instance volume
│           ├── secret-store.ts                       # NEW — read/write/delete secret entries in per-instance .env, redacted-list helpers, reserved-name guard
│           └── mgmt-api-mapping.ts                   # NEW — pure functions that translate supastack entities into cloud-API response shapes
├── web/
│   └── src/
│       ├── pages/
│       │   ├── ConnectCli.tsx                        # NEW — the "Connect CLI" view (TOML snippet, copy buttons, three commands)
│       │   └── SettingsTokens.tsx                    # MODIFY — surface the new sbp_ format and add "Use with Supabase CLI" callout
│       ├── components/
│       │   └── CliCommandBlock.tsx                   # NEW — small component for the copy-and-run command boxes
│       └── lib/
│           └── api.ts                                # MODIFY — add `cliApi.profile()`, `cliApi.mintToken()` clients
└── worker/                                           # NOT TOUCHED — provisioning logic unchanged

packages/
├── db/
│   └── migrations/
│       └── 0002_cli_compat.sql                       # NEW idempotent migration — adds project_functions, project_secrets, function_deploys tables
└── shared/
    └── src/
        └── schemas.ts                                # MODIFY — Zod schemas for management-API request/response shapes (mirror of contracts/management-api.yaml)

infra/
├── docker-compose.yml                                # NOT TOUCHED — api container already has every mount this feature needs
└── supabase-template/
    └── volumes/
        └── functions/
            └── main/
                └── index.ts                          # MODIFY — eszip-aware lazy loader; reads <slug>/meta.json, dispatches via
                                                      #   EdgeRuntime.userWorkers.create({ maybeEszip, maybeEntrypoint }) when bundle.eszip
                                                      #   is present, falls back to servicePath-based loading otherwise. ~15 added lines.
```

**Structure Decision**: Slot the new management-API surface under `apps/api/src/routes/management/` as a sibling to the existing `routes/` files, mounted at `/v1/*` via a Fastify route prefix in `server.ts`. This keeps it cleanly separated from the existing dashboard-facing `/api/v1/*` surface (which is supastack-internal and uses session cookies), even though both end up under different prefixes on the same Fastify instance. Authentication is dual-mode in `auth.ts` (already supported): the session cookie is for dashboard requests, the bearer-token path is for the new management surface — the same `request.user` is populated either way.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. The constitution is unratified, and the proposed structure follows existing patterns from `001-supastack-supabase-platform`.
