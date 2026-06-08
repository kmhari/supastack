# Contract — Shared org-creation primitive (P3)

## New service `apps/api/src/services/org-store.ts`

```ts
import { schema } from '@supastack/db';
import { generateRef } from '...';          // existing ref generator (feature 084)
import type { Inserter } from './api-tokens.js';  // reuse exported tx/Inserter type

export async function createOrganizationWithOwner(
  tx: Inserter,
  { userId, name }: { userId: string; name: string },
): Promise<{ id: string; name: string }> {
  const id = generateRef();
  await tx.insert(schema.organizations).values({ id, name });
  await tx.insert(schema.organizationMembers)
    .values({ organizationId: id, userId, role: 'owner' });
  return { id, name };
}
```

- Accepts a transaction handle so the caller owns the boundary.
- Performs **no** auth (callers authorize).
- `name` assumed already trimmed/validated by the caller.

## Caller 1 — `POST /platform/organizations` (platform-misc.ts:284-297)

Keep `requireAuth`, the `name` trim + 400-on-empty, and the `buildOrg(id, name, true)` response (unchanged wire shape). Replace the inline insert pair with:
```ts
const { id } = await db().transaction((tx) =>
  createOrganizationWithOwner(tx, { userId: user.id, name }));
return reply.status(201).send({ pending_payment_intent_secret: null, ...buildOrg(id, name, true) });
```

## Caller 2 — `setup.ts` (inside the existing transaction)

Replace the pre-tx `const orgId = generateRef()` (line 48) and the inline org+member inserts (lines 67-77) with, **after** the in-tx `setup_state` re-check:
```ts
const { id: orgId } = await createOrganizationWithOwner(tx, {
  userId: operator.id, name: body.orgName,
});
```
Installation insert, `setup_state`, audit (`targetId: orgId`), master-PAT mint, and the ownerless-org backfill stay in `setup.ts` unchanged. First user stays `ensureGotrueUser` (no legacy users-table write).

## Acceptance

- Unit: `createOrganizationWithOwner` inserts one org + one `owner` membership; returns `{id, name}`; id matches the ref format.
- `POST /platform/organizations` response shape byte-identical to today (`buildOrg` + `pending_payment_intent_secret`).
- Fresh setup: operator is a GoTrue `auth.users` row (no `public.users` insert); the created org is owned by the operator; `GET /platform/organizations` (as the operator) lists it.
- Setup remains atomic (a forced failure after org-create rolls back the org) and `setup_state`-gated (re-POST → 410, no org created).
- Org rows created via setup vs `/platform/organizations` are structurally identical.
