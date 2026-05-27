# Implementation Plan: Cap Kong Worker Processes Per Project

**Branch**: `017-kong-worker-cap` | **Date**: 2026-05-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-kong-worker-cap/spec.md`

## Summary

Add `KONG_NGINX_WORKER_PROCESSES: "2"` to the kong service in the per-instance compose template (`infra/supabase-template/docker-compose.yml`). This is a one-line static config change. Rollout on the production VM is `docker compose up -d kong` per project (rolling, ~seconds of downtime per project). No code paths in `apps/api`, `apps/worker`, `packages/docker-control` reference Kong worker counts, so no software changes are required.

## Technical Context

**Language/Version**: N/A — config-only change (YAML in `infra/supabase-template/`).

**Primary Dependencies**: `kong/kong:3.9.1` (already pinned in template).

**Storage**: N/A.

**Testing**: No automated tests for this surface today. Verification is operational: container stats + a smoke check that REST/Auth/Storage routes through kong respond normally.

**Target Platform**: Linux x86_64 host, Docker Compose, per-project stack.

**Project Type**: Infra config change (single file in `infra/supabase-template/`).

**Performance Goals**: Per-project gateway idle RSS < 300 MiB; gateway p95 latency regression ≤ 5%.

**Constraints**: Must not affect external API behavior; existing in-flight projects upgrade by re-deploying their kong service; no per-project manual config.

**Scale/Scope**: One file edited, one env var added, one deploy step per project.

## Constitution Check

The project constitution at `.specify/memory/constitution.md` is the unfilled template (placeholders only). No concrete gates to evaluate.

The implicit cross-cutting conventions from `CLAUDE.md` that apply here:

- **Schema changes are additive / no destructive migration** — N/A; this is a runtime config knob, no schema.
- **Per-instance state changes go through the worker** — N/A; this is a template change applied at provision time and at next gateway re-deploy. No state mutation.
- **Tests prefer pure functions; live VM E2E for integration** — verification is a live-VM operational check (see `quickstart.md`).
- **Spec-driven dev** — this plan is the third artifact (spec → plan → tasks) for feature 017.

**Result**: PASS. No gate violations.

## Project Structure

### Documentation (this feature)

```text
specs/017-kong-worker-cap/
├── spec.md              # /speckit-specify output
├── plan.md              # this file
├── research.md          # Phase 0 — config choice + risk analysis
├── quickstart.md        # Phase 1 — verification recipe (live VM)
├── checklists/
│   └── requirements.md  # quality checklist from /speckit-specify
└── tasks.md             # /speckit-tasks output (not yet)
```

`data-model.md` and `contracts/` are intentionally not produced: this change has no entities, no schemas, and no external interfaces. The "contract" of the per-project gateway is unchanged — REST/Auth/Storage/Realtime routes behave identically.

### Source Code (repository root)

```text
infra/
└── supabase-template/
    └── docker-compose.yml          # ONLY file modified — kong.environment block gets one new key
```

**Structure Decision**: Single file edit in `infra/supabase-template/docker-compose.yml`. No new files. No package, app, or test changes.

## Phase 0 — Research

See `research.md` for full reasoning. Headline decisions:

- **Choose env var, not custom kong.conf**: `KONG_NGINX_WORKER_PROCESSES` is the official Kong-recognized env-var form of the `nginx_worker_processes` directive. It is read at container start by Kong's standard entrypoint and applied to the generated `nginx.conf`. No custom template file needed.
- **Default value: 2**: Empirically motivated. Today's per-project gateways show near-zero idle CPU and only brief sub-1% spikes under dashboard + CLI traffic. One worker is risky (a single slow Lua coroutine can block all requests); two gives headroom without LuaJIT VM × N memory blow-up. `auto` would pick 12 on the production VM — wildly over-provisioned.
- **Apply to template, not per-project compose files**: The per-project compose files are generated from `infra/supabase-template/docker-compose.yml`. Editing the template means new projects get the value automatically; existing projects get it the next time their generated compose is regenerated, or by passing the env directly to `docker compose up -d kong`.

## Phase 1 — Design & Contracts

**Data model**: none (no entities).

**Contracts**: none. The HTTP-level contract of the per-project gateway is unchanged. Existing tests in `tests/cli-e2e/` exercise the same routes and continue to apply.

**Agent context**: `CLAUDE.md` already references the active feature pointer. The pointer will be updated to feature 017 either by the next merge or by `/speckit-tasks`. Not blocking.

**Quickstart**: `quickstart.md` — a 6-step live-VM verification recipe (stats before, edit, re-deploy one project, stats after, smoke test, then roll the remaining projects).

## Complexity Tracking

No constitution violations. No complexity to justify.
