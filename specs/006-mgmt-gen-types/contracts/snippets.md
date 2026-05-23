# Contract: `/v1/snippets[/<id>]`

Powers `supabase snippets list` and `supabase snippets download <id>`.

NOT scoped to a project in the path — snippets are a user-level concept in Cloud, and the API mirrors that. Optional `?project_ref=` narrows to one project.

## Endpoints

```
GET /v1/snippets[?project_ref=<ref>]
GET /v1/snippets/<id>
```

Both require `Authorization: Bearer <PAT>`. Both are read-only.

---

## `GET /v1/snippets`

### Query params

| Param | Required | Notes |
|---|---|---|
| `project_ref` | no | If set, scope to that project. Otherwise aggregate across all accessible projects (cap 50). |

### Response 200
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Slow queries last hour",
      "description": "From pg_stat_statements",
      "project": { "id": "enzyxdtrbosuwjwzkmvl", "name": "huntvox" },
      "owner": { "id": "f2e5e1cc-df33-47b0-9baf-6b428dd21aef" },
      "visibility": "project",
      "type": "sql",
      "inserted_at": "2026-05-20T10:00:00Z",
      "updated_at": "2026-05-23T12:00:00Z"
    }
  ]
}
```

Body field is `data` (matches upstream). NO `content` in the list response — fetch the body via `/v1/snippets/<id>`.

### Behavior
1. Resolve caller's accessible projects via existing RBAC.
2. If `project_ref` given, narrow to that one; 403 if no access.
3. For each project (parallelized, cap 50):
   - Connect to per-instance PG.
   - `SELECT id, name, description, owner_id, visibility, type, inserted_at, updated_at FROM user_content.content WHERE type = 'sql' AND (visibility = 'project' OR visibility = 'org' OR owner_id = $caller_id)`.
   - If `user_content` schema doesn't exist, treat as zero rows (FR-015).
4. Merge results, sort by `updated_at` desc.
5. Cap response at 200 rows (SC-006 ceiling) with truncation indicator if more exist.

---

## `GET /v1/snippets/<id>`

### Response 200
```json
{
  "id": "550e8400-...",
  "name": "Slow queries last hour",
  "description": "From pg_stat_statements",
  "content": "SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;",
  "project": { "id": "enzyxdtrbosuwjwzkmvl", "name": "huntvox" },
  "owner": { "id": "f2e5e1cc-..." },
  "visibility": "project",
  "type": "sql",
  "inserted_at": "2026-05-20T10:00:00Z",
  "updated_at": "2026-05-23T12:00:00Z"
}
```

Includes the `content` field (SQL body).

### Response 404
- Snippet doesn't exist, OR exists but not accessible to caller (do NOT distinguish — don't leak existence per FR + edge case).

### Behavior
1. Iterate caller's accessible projects (same RBAC list).
2. For each project, attempt `SELECT * FROM user_content.content WHERE id = $1`.
3. First match: check visibility against caller's owner_id + project_access; if allowed, return; else continue.
4. Exhausted: 404.

**Optimization**: cache an `id → project_ref` mapping in Redis for 60s after a hit (snippet ids are UUIDs, so cache is effective). On miss, full scan.

---

## Cross-cutting

### Visibility rules (FR-013)
- `user`: visible only to `owner_id == caller_user_id`
- `project`: visible to any caller with access to that project
- `org`: visible to any caller with access to ≥1 project in the same org as the snippet's project

### Errors
Standard envelope. Common codes: `not_found`, `forbidden`.

### Performance
- `list`: <2s for ≤200 snippets (SC-006). N+1 over accessible projects bounded at 50.
- `download`: <3s for ≤5MB body (SC-006).

### Test cases
| # | Scenario | Expected |
|---|---|---|
| 1 | List with no snippets across all projects | 200, `data: []` |
| 2 | List with snippets across 2 projects, no filter | 200, merged + sorted |
| 3 | List with `?project_ref=` for a project caller has access to | 200, scoped |
| 4 | List with `?project_ref=` for a project caller doesn't have access to | 403 |
| 5 | Download existing accessible snippet | 200, full body |
| 6 | Download snippet with `visibility=user` owned by another user | 404 |
| 7 | Download non-existent id | 404 |
| 8 | List with `user_content` schema absent in one of N projects | 200, that project contributes 0; others unaffected |
| 9 | Download snippet of 4MB body | 200 in <3s, body intact |
| 10 | Unauth | 401 |
