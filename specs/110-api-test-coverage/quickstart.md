# Test Conventions Reference

This document captures the canonical test patterns for feature 110. All new test files must follow these conventions.

## Anatomy of a Route Unit Test

```typescript
// 1. Hoist mutable mock state
const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  reject: null as Error | null,
}));

// 2. Mock the module under test
vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            h.reject ? Promise.reject(h.reject) : Promise.resolve(h.rows),
        }),
      }),
    }),
  }),
  schema: { /* column references only */ },
}));

// 3. Import route under test (after mocks)
const { myRoutes } = await import('../../src/routes/my-routes.js');

// 4. Build app helper with authed toggle
async function buildApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => {
    if (!authed) throw Object.assign(new Error('unauthenticated'), { statusCode: 401 });
    return { id: 'u1', email: 'a@b.c', role: 'owner' };
  });
  app.decorate('authorize', () => {});
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({ error: err.message });
  });
  await app.register(myRoutes);
  return app;
}

// 5. Reset mocks in beforeEach
beforeEach(() => {
  h.rows = [];
  h.reject = null;
});
```

## Test Coverage Matrix (per endpoint)

| Test | Method | Expected |
|------|--------|----------|
| happy path — correct shape | `app.inject(...)` with valid req | 200 + body shape assertion |
| happy path — empty/null case | mock returns empty/null data | 200 + expected default |
| sad path — unauthenticated | `buildApp(false)` | 401 |
| sad path — DB/proxy error | set `h.reject = new Error(...)` | 500 |
| sad path — not found (where applicable) | mock returns empty array | 404 |

## Platform Route Pattern

Routes in `platform-misc.ts` use `platformMiscRoutes`:

```typescript
const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

async function buildApp(authed = true) {
  const app = Fastify();
  app.decorate('requireAuth', () => { /* ... */ });
  app.decorate('authorize', () => {});
  app.decorate('authorizeOrg', async () => 'owner');
  app.setErrorHandler((err, _req, reply) => {
    reply.status((err as { statusCode?: number }).statusCode ?? 500)
      .send({ error: err.message });
  });
  await app.register(platformMiscRoutes);
  return app;
}
```

## Management API Route Pattern

Routes in `apps/api/src/routes/management/` need the management error plugin:

```typescript
import { mgmtApiErrorsPlugin } from '../../src/plugins/mgmt-api-errors.js';

async function buildApp(authed = true) {
  const app = Fastify();
  app.decorate('requireAuth', () => { /* ... */ });
  app.decorate('authorize', () => {});
  app.setErrorHandler((err, _req, reply) => {
    reply.status((err as { statusCode?: number }).statusCode ?? 500)
      .send({ error: err.message });
  });
  await app.register(async (scope) => {
    await scope.register(mgmtApiErrorsPlugin);
    await scope.register(myRoutes);
  }, { prefix: '/v1' });
  return app;
}
```

## Running the Tests

```bash
# From repo root
pnpm --filter @supastack/api test

# Run a single file
pnpm --filter @supastack/api exec vitest run tests/unit/platform-services.test.ts
```
