# supastack docs

End-user-facing documentation for supastack deployments.

| Doc                                      | What it covers                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [supabase-cli.md](./supabase-cli.md)     | How to use the unmodified upstream `supabase` CLI against a supastack deployment — login, link, deploy edge functions, manage secrets. Includes the setup ritual, the known wrinkles, and troubleshooting. |
| [host-hardening.md](./host-hardening.md) | Optional upstream Ubuntu security tools (sdaudit, ubuntu-cis-audit, ubuntu-nix-sbom) operators can run on the VM for compliance audits. Not installed by supastack.                                        |

For the engineering side of supastack (architecture, contributing, internal APIs), see [`/plan.md`](../plan.md) at the repo root and the feature specs under [`/specs/`](../specs/).
