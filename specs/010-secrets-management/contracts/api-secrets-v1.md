# Contract — `/v1/projects/<ref>/secrets` (Supabase Management API compat surface)

**Status**: Preserved wire contract — exact request/response shapes unchanged from feature 003 US4. Only the backend storage flips from `project_secrets` + `.env` writes to `vault.secrets`.

**Auth**: PAT (`Authorization: Bearer <pat>`); RBAC: `instance.secrets.read` for GET, `instance.secrets.write` for POST/DELETE.

---

## GET `/v1/projects/<ref>/secrets`

List custom secrets (digests only; never plaintext).

**200 OK**
```json
{
  "secrets": [
    { "name": "OPENAI_API_KEY", "valueSha256": "9f86d081...", "updatedAt": "2026-05-25T12:00:00.000Z" }
  ]
}
```

Implementation:
1. `SELECT name, decrypted_secret, updated_at FROM vault.decrypted_secrets WHERE key_id IS NOT NULL ORDER BY name`
2. For each row: compute `sha256(decrypted_secret).hex` server-side, drop the plaintext from the response.
3. Filter out reserved names (defense in depth — should be impossible by write-side guard).

**4xx**:
- `401` — missing/invalid PAT
- `403` — PAT lacks `instance.secrets.read`
- `404` — ref unknown
- `503` — per-project vault unreachable (DB down / extensions missing)

---

## POST `/v1/projects/<ref>/secrets`

Batch upsert. Atomic: any rejected entry fails the whole batch.

**Request**
```json
{
  "secrets": [
    { "name": "OPENAI_API_KEY", "value": "sk-..." },
    { "name": "FOO", "value": "bar" }
  ]
}
```

**Validation** (per entry, fail-fast on first violation):
- `name` matches `/^[A-Za-z_][A-Za-z0-9_]*$/`, length 1..64
- `name` is not in `RESERVED_SECRET_NAMES`
- `value` is non-empty

**200 OK**
```json
{
  "secrets": [
    { "name": "OPENAI_API_KEY", "valueSha256": "ab12...", "updatedAt": "2026-05-25T12:00:00.000Z" },
    { "name": "FOO", "valueSha256": "fc8e...", "updatedAt": "2026-05-25T12:00:00.000Z" }
  ]
}
```

Implementation (single Postgres transaction):
```
BEGIN;
  -- For each entry:
  --   if name exists: SELECT vault.update_secret(id, $value) (id from SELECT … WHERE name=$name)
  --   else:           SELECT vault.create_secret($value, $name)
COMMIT;
```
Then re-issue the GET-style fetch and return for the affected names.

**4xx**:
- `400` — `{ "code": "invalid_name", "name": "1FOO" }` or `{ "code": "reserved_name", "name": "SUPABASE_URL" }` or `{ "code": "empty_value", "name": "X" }`
- `401`, `403`, `404` — as above
- `503` — vault unreachable

**Audit**: emit `instance.secrets.set` with `{ ref, names: [...] }` (no values).

**Notable behavior change from prior implementation**: No functions-container restart. The save is observable in `Deno.env.get()` within ≤10s (TTL window).

---

## DELETE `/v1/projects/<ref>/secrets`

Batch delete by name.

**Request**
```json
{ "names": ["FOO", "BAR"] }
```

**200 OK**
```json
{ "deleted": ["FOO", "BAR"] }
```

Implementation:
```
DELETE FROM vault.secrets WHERE name = ANY($1::text[]) RETURNING name;
```

Names not present in vault are silently skipped (return only the names actually deleted) — matches prior behavior.

**4xx**: as above. Reserved names in the request → 400 `{ "code": "reserved_name", "name": "..." }` (refuse the whole batch; reserved names shouldn't exist in vault but reject for symmetry with POST).

**Audit**: emit `instance.secrets.delete` with `{ ref, names: [...] }`.

---

## Contract test obligations

Snapshot-based contract test (`apps/api/tests/contract/secrets-v1.contract.test.ts`) MUST cover:

1. Every status code path above
2. Request/response body shape (JSON Schema match against baseline captured from current prod)
3. Header presence: `Content-Type: application/json` on all responses
4. RBAC denial paths (admin PAT vs viewer PAT vs no PAT)
5. Batch atomicity: one reserved name in a 10-entry POST → 400 + zero rows persisted

Snapshot baseline lives at `apps/api/tests/contract/__snapshots__/secrets-v1.snap` and MUST NOT drift across this feature's PR.
