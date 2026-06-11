# Contract — `/api/v1` surface deltas (dashboard surface; no `/v1` drift)

These are **dashboard** endpoints (`/api/v1/*`), not the pinned Management API (`/v1/*`). Constitution IV unaffected.

## `GET /api/v1/apex` — env-backed (behavior change, shape compatible)

- Source of `apex` changes from the DB column to `getApex()` (env). On a configured install, `apex` is non-null (was null until `/setup` wrote it) → the wizard skips the domain-entry step.
- Response keeps its existing shape (`apex`, `expectedIp`, `observedIps`, `dnsResolved`, `wildcardResolved`, `httpsReachable`, `cert`, …).
- The DNS/cert probes still run only when `apex` is set; additionally, the wizard treats `isRealApex(apex) === false` as "local/default — block the DNS+cert step" (see UI contract below).

## `POST /api/v1/setup` — `apexDomain` removed from the body

- **Before**: body accepted `{ email, password, orgName, apexDomain? }` and upserted `installation.apexDomain`.
- **After**: body is `{ email, password, orgName }`. The `installation` singleton is still created; no apex is written (apex comes from env).
- Zod schema in `@supastack/shared` drops the `apexDomain` field; an extra `apexDomain` in the body is ignored or rejected per the schema's existing strictness (no behavior depended on it).

## `PATCH /api/v1/org` — `apexDomain` removed

- **Before**: `{ name?, apexDomain? }`; writing `apexDomain` updated the column and triggered a Caddy reload.
- **After**: `{ name? }`. No apex write, no apex-change reload. The response projection no longer includes `apexDomain`.
- Authorization unchanged (existing `org` write gate); **no new RBAC action**.

## UI contract — `apps/web/src/pages/Setup.tsx`

- The `DomainCertsStep` MUST NOT render a domain-entry input. It reads the established apex from `apexApi.status()`.
- If `isRealApex(apex)` is false → render a **blocking** state: "You're on a local/default domain (`localhost`). Re-run the installer with a real domain to enable HTTPS." No DNS records, no cert attempt, no input.
- If `isRealApex(apex)` is true → render the DNS-records step directly (apex A record, wildcard A record, ACME TXT), then verify → issue cert → admin creation (unchanged downstream).
- `setupApi.run` and `orgApi.patch` body types in `apps/web/src/lib/api.ts` drop `apexDomain`.
