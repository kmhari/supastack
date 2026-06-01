# @supastack/shared

Shared types, schemas, RBAC, and the structured logger.

## Surfaces

| Module             | Exports                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `logger.ts`        | `logger`, `makeLogger(bindings)` — pino with secret redaction                  |
| `errors.ts`        | `AppError`, `errors.*` helpers (`unauthenticated`, `forbidden`, `notFound`, …) |
| `rbac.ts`          | `ROLES`, `ACTIONS`, `can(role, action)`, `permissionMatrix()`                  |
| `state-machine.ts` | `INSTANCE_STATES`, `canTransition(from, to)`, `nextStates(from)`               |
| `schemas.ts`       | zod schemas for every REST request body                                        |

## RBAC

Two roles: `admin`, `member`. The full matrix lives in `rbac.ts` and is
snapshot-tested in `apps/api/tests/contract/rbac.test.ts`. Members can list

- read + reveal credentials; admins additionally manage lifecycle, members,
  backup store, and audit.

The matrix is the single source of truth — `app.authorize(req, action)` in
`apps/api/src/plugins/rbac.ts` consults `can(role, action)` and throws
`errors.forbidden()` on deny.

## State machine

Allowed transitions for `supabase_instances.status` are pinned in
`state-machine.ts` and enforced by both the API (rejects invalid `PATCH`
operations) and the worker (refuses to act on stale rows).

## Logger

```ts
import { logger, makeLogger } from '@supastack/shared';
logger.info({ ref: 'abc' }, 'instance provisioned');
const child = makeLogger({ service: 'worker', job: 'backup' });
```

Production output is JSON (`pino`); dev is pretty (`pino-pretty`).
`redact` strips `password`, `*_key`, `*_secret`, `MASTER_KEY`,
`headers.authorization`, `headers.cookie`, etc.
