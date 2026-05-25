# Selfbase change log — per-feature documentation

One markdown file per shipped feature. Each documents what changed, why it changed, the architecture decisions taken, the bugs found during implementation, and pointers to the key files.

For the high-level project guide and active feature pointer, see [CLAUDE.md](../../CLAUDE.md) in the repo root.

## Shipped features

| Feature | Issue(s) | One-line summary |
|---|---|---|
| [004 — Wildcard TLS via DNS-01](004-wildcard-cert-dns01.md) | #2 | Single `*.<apex>` cert via manual DNS-01 in `/setup` wizard; replaces per-subdomain on-demand TLS |
| [005 — Postgres public endpoint](005-postgres-public-endpoint.md) | #3 | `db.<ref>.<apex>:5432` (custom STARTTLS+SNI proxy) + `pooler.<apex>:6543` (top-level supavisor); per-project ACME cert for strict-TLS clients |
| [006 — Supabase CLI Tier 1](006-cli-mgmt-tier1.md) | #4 (parent), #15 (PR) | `supabase gen types typescript` + `supabase migration list/repair/fetch` |
| [008 — Pooler resilience](008-pooler-resilience.md) | #7, #8, #9, #17 (PR) | Daily reconciler cron + dashboard panel + PG password drift recovery |

## In flight (spec'd, not yet shipped)

| Feature | Issue | Status |
|---|---|---|
| 007 — Auto cert renewal via Cloudflare DNS API | #6 | Spec on branch `007-auto-cert-renewal`, not implemented |

## Deferred (broken out to follow-up issues)

| What | Issue |
|---|---|
| Backups list/restore (006 US4) — heavy async worker | #14 |
| Snippets list/download (006 US3) — needs Studio store first | #13 |
| Custom domains (006 Tier 1 sibling) | #10 |
| postgres-config + auth-config tunables | #11 |
| ssl-enforcement toggle | #12 |
| Vitest for pooler-reconciler service (008 T029) | #16 |

## Operator runbooks (separate from per-feature docs)

| Doc | Topic |
|---|---|
| [../wildcard-tls.md](../wildcard-tls.md) | DNS-01 workflow, troubleshooting, renewal |
| [../pooler-resilience.md](../pooler-resilience.md) | Reading the dashboard panel, drift recovery, prevention notes |
| [../supabase-cli.md](../supabase-cli.md) | What CLI commands work, profile setup, examples |
| [../vm-reset.md](../vm-reset.md) | Wipe + re-provision the VM from scratch |
