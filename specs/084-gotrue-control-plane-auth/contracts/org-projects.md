# Contract — Organization Projects (platform API)

Shape captured from Studio source (`apps/studio/data/projects/org-projects-infinite-query.ts`).
This is the org-scoped project list (US5) — the primary place projects surface in IS_PLATFORM Studio.

## GET /platform/organizations/:slug/projects
Paginated list of the org's projects. Authorize: any member of `:slug` (`instance.list` in that org).
- **Query**: `{ limit?: int (default 96), offset?: int (default 0),
  sort?: 'name_asc'|'name_desc'|'created_asc'|'created_desc', search?: string, statuses?: string[] }`.
- **200**: `{ pagination: { count, limit, offset },
  projects: [{ ref, name, status: 'INACTIVE'|'ACTIVE_HEALTHY'|'ACTIVE_UNHEALTHY'|…, inserted_at,
  region, cloud_provider, integration_source: null, is_branch: false,
  databases: [{ identifier, type: 'PRIMARY', region, cloud_provider, status,
  infra_compute_size, ... }] }] }`.
- Returns ONLY projects whose `organization_id` = the org. `count` is the total in that org (for the
  given filters); `limit`/`offset` echo the request.
- Map supastack instance fields → this shape: `ref`, `name`, lifecycle `status` → the Cloud status
  enum, `inserted_at` from created-at, `region`/`cloud_provider` from constant self-hosted markers,
  one `PRIMARY` database entry. Read-replica / branch fields absent → defaults.

## Acceptance (happy + sad)
- **Happy**: an org with 2 projects → `pagination.count = 2`, both in `projects`; `search` narrows
  the list; a Developer in the org sees the list.
- **Sad**: a non-member requests the org's projects → `403`; `offset` past the end → empty `projects`
  with the correct `count`.
