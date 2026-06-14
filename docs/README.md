# Supastack docs

Operator-facing documentation. For what supastack is and how to install it,
start with the [repo README](../README.md). A running deployment also serves
personalized guides (pre-filled with your domain) at `https://<apex>/docs`.

## Start here

| Doc                                                      | What it covers                                                                                                                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [supastack-vs-selfhost.md](./supastack-vs-selfhost.md)   | **What Supastack adds** over the official open-source Supabase self-hosting setup — multi-project, CLI/Management API compat, TLS, backups, MCP, RBAC.                                                                |
| [containers-and-updates.md](./containers-and-updates.md) | **The operations hub** — every container the platform runs (control plane, platform Studio, per-project stacks), where each version is pinned, Docker Hub image publishing, and the update runbook for each category. |
| [supabase-cli.md](./supabase-cli.md)                     | Using the unmodified upstream `supabase` CLI against a supastack deployment — login, link, db push, edge functions, secrets. Setup ritual, known wrinkles, troubleshooting.                                           |
| [wildcard-tls.md](./wildcard-tls.md)                     | The wildcard `*.<apex>` certificate (DNS-01) — issuance via `/setup`, renewal, registrar-specific TXT instructions.                                                                                                   |

## Operations

| Doc                                            | What it covers                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| [pooler-resilience.md](./pooler-resilience.md) | Supavisor pooler drift classes, the daily reconciler, PG password drift recovery.      |
| [vm-reset.md](./vm-reset.md)                   | Wiping a VM to a clean pre-setup state and re-running setup.                           |
| [host-hardening.md](./host-hardening.md)       | Optional Ubuntu security/compliance tooling for the host (not installed by supastack). |

## Platform Studio

The dashboard is upstream Supabase Studio (`IS_PLATFORM=true`) built as a
prebuilt, domain-agnostic image from the fork
[`kmhari/supabase#supastack-studio`](https://github.com/kmhari/supabase/tree/supastack-studio).

- **Every source deviation from upstream** is documented with reasoning in
  [SUPASTACK-PATCHES.md on the branch](https://github.com/kmhari/supabase/blob/supastack-studio/SUPASTACK-PATCHES.md)
  (policy: smallest possible diff).
- Image build: [`infra/studio-platform/`](../infra/studio-platform/) —
  placeholder apex baked at `next build`, substituted with `SUPASTACK_APEX`
  at container start.
- Keeping the fork current: [`scripts/sync-studio-fork.sh`](../scripts/sync-studio-fork.sh)
  (fast-forwards fork `master` from upstream, rebases the patch branch).
- Full update procedure: [containers-and-updates.md §2](./containers-and-updates.md).

## Images

All five platform images are public on Docker Hub, dual-tagged
`<git-sha>` + `latest`:

`kmhariharasudhan/supastack-{api,worker,mcp,web,studio-platform}`

Production deployments pin shas via `SUPASTACK_VERSION` /
`STUDIO_PLATFORM_VERSION` in `infra/.env` — rationale and procedure in
[containers-and-updates.md §1a](./containers-and-updates.md).
