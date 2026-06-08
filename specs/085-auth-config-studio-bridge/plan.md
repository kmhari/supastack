# Implementation Plan: Auth Config (GoTrue settings per project) — Studio parity

**Branch**: `085-auth-config-studio-bridge` | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/085-auth-config-studio-bridge/spec.md`

## Summary

The dashboard (Studio, `IS_PLATFORM=true`) reads/writes a project's auth config through `GET/PATCH /platform/auth/:ref/config`, sending **UPPERCASE GoTrue-config field names** (`EXTERNAL_GITHUB_ENABLED`). The platform bridge (`apps/api/src/routes/platform-misc.ts:434-445`) re-injects that body/response **unchanged** to the Management API `/api/v1/projects/:ref/config/auth`, whose `UpdateAuthConfigBodySchema` is `.strict()` and only knows **lowercase snake_case** names (`external_github_enabled`) → PATCH 400 `unknown_field`; GET returns lowercase keys Studio can't read.

**Technical approach**: add a thin, dictionary-driven **case-translation adapter** at the platform bridge only — lowercase the request keys before re-inject (PATCH), uppercase the config keys in the response (GET) — keeping the Management API `/v1/*` contract (lowercase, CLI) byte-for-byte unchanged (Constitution IV). The translation is a verified clean case-flip against the 134 honored field-mapper keys (`STUDIO_KEY.toLowerCase() === api_key`), with an explicit alias table for any field whose Studio name diverges beyond case. Add the missing `/config/hooks` GET/PATCH (no handler exists today) backed by the existing hook-field subset. Fix the error masking by routing the bridge through the surface that carries the `ManagementApiError` envelope (or teaching the platform error handler to honor it) so validation failures surface as 400 + field details instead of 500 "internal error". No DB migration, no new dependency.

## Technical Context

**Language/Version**: TypeScript (Node 20), existing supastack `apps/api` Fastify service

**Primary Dependencies**: Fastify (in-process `app.inject` for the bridge), Zod (`UpdateAuthConfigBodySchema`), existing `env-field-mapper.ts` (134 honored fields, the source of truth for valid field names), `runtime-config-store.ts` (`patchConfig` / `_supastack.fieldStatus` builder). No new dependency.

**Storage**: None added. Auth config continues to live in the per-instance `.env` (applied + GoTrue reloaded by the existing mechanism). No control-plane schema change → no migration (Constitution I trivially satisfied).

**Testing**: Vitest unit tests in `apps/api/tests/unit/` (pure translation function + bridge route via `app.inject`); extend the existing auth-config snapshot/contract tests; live bash check on `supaviser.dev` against project `tbnqljlgozpxzhkjxats`.

**Target Platform**: Linux server (single self-hosted VM)

**Project Type**: Web service (control-plane API) — translation layer at an existing route; zero Studio source changes.

**Performance Goals**: Negligible — an O(field-count) key remap per request (≤ ~250 keys). No measurable latency impact on the existing config call.

**Constraints**: Management API `/v1/*` request/response/validation MUST NOT change (pinned upstream contract). Studio is upstream — cannot be modified; the platform side must adapt to its shape.

**Scale/Scope**: 134 honored auth fields + the `stored_only`/`unsupported` remainder (≈234 total) reachable by Studio; 4 endpoints (config GET/PATCH + hooks GET/PATCH); 1 error-envelope fix.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Idempotent, Additive Schema Evolution** — ✅ N/A. No migration; this is an API translation layer.
- **II. Secrets Stay Encrypted, Master Key Stays Home** — ✅ Secret-bearing fields (client secrets, SMTP password, hook secrets) continue to flow through the existing encrypted per-instance secret path; the adapter only remaps **key names**, never decrypts or relocates values. Read masking behavior is preserved.
- **III. Authorize Every Privileged Action** — ✅ Reuses existing `auth_config.read` / `auth_config.write` actions; the new `/config/hooks` GET/PATCH declare the same actions. No new RBAC cell needed (verified during Phase 1; if a distinct action is preferred, it's added to the matrix).
- **IV. Supabase Compatibility Is a Pinned Contract** — ✅ **Core gate.** The fix is deliberately confined to the **platform** bridge (`/platform/auth/:ref/config`). The Management API `/v1/projects/:ref/config/auth` keeps its lowercase, `.strict()` schema and snapshot — guaranteed by an unchanged-contract regression test (FR-005/SC-005). The translation cannot leak into the `/v1` surface.
- **V. The Worker Owns Per-Instance State** — ✅ Unchanged. The adapter does not alter how config is applied; the existing apply-env + GoTrue-reload mechanism (synchronous admin action, already in place for feature 020) is reused verbatim.
- **VI. Spec-Driven, Evidence-Based Delivery** — ✅ This plan; contracts + quickstart; live verification on the VM; the coverage-doc guard (FR-012/SC-008).

**Result: PASS** — no violations, Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/085-auth-config-studio-bridge/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (case-flip vs envName, hooks wiring, error envelope)
├── data-model.md        # Phase 1 — field-name conventions + translation map + hook entity
├── quickstart.md        # Phase 1 — live verification steps on supaviser.dev
├── contracts/           # Phase 1 — the 4 endpoint contracts + the no-regression /v1 contract
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/api/src/
├── services/
│   ├── auth-config-case.ts        # NEW — pure bidirectional case-translation (toApiKeys / toStudioKeys)
│   │                              #       driven by the env-field-mapper key set + alias table
│   └── env-field-mapper.ts        # READ — source of truth for valid lowercase field names (134 honored)
├── routes/
│   ├── platform-misc.ts           # EDIT — bridge GET/PATCH /platform/auth/:ref/config: apply translation;
│   │                              #        add GET/PATCH /platform/auth/:ref/config/hooks
│   └── management/auth-config.ts   # UNCHANGED — /v1 handler (lowercase, pinned contract)
├── plugins/mgmt-api-errors.ts      # READ — the ManagementApiError envelope (400 + details)
└── server.ts                       # EDIT (small) — let the platform error path surface ManagementApiError
                                    #        status+details instead of generic 500 (or route bridge via /v1)

apps/api/tests/unit/
├── auth-config-case.test.ts        # NEW — pure translation: happy (round-trip), sad (alias, _supastack meta)
├── auth-config-bridge.test.ts      # NEW — bridge route via app.inject: Studio uppercase PATCH→200, GET uppercase
└── auth-config-response-shape.test.ts  # EXTEND — assert /v1 lowercase contract unchanged (no regression)

scripts/studio-mock-api/API-FULL-COMPARISON.md   # EDIT — flip the 4 Auth Config rows ⚠️→✅ once shipping
tests/cli-e2e/                                    # NEW — auth-config-studio.sh live check (provider round-trip)
```

**Structure Decision**: Single control-plane service (`apps/api`). The translation is isolated in one new pure module (`auth-config-case.ts`) consumed only by the platform bridge, so the `/v1` Management path is provably untouched. Zero Studio/`apps/web` source changes.

## Complexity Tracking

> No Constitution violations — section intentionally empty.
