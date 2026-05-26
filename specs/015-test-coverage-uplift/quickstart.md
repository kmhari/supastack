# Quickstart: Test Coverage Uplift

## Run the coverage baseline locally

```bash
pnpm install
pnpm test:coverage
```

Reads `scripts/coverage.mjs`; prints a per-package table. Compare against [contracts/coverage-targets.md](./contracts/coverage-targets.md).

## Iterate on a single package

```bash
# unit watch
pnpm --filter @selfbase/shared test:watch

# one-shot coverage for one package
pnpm --filter @selfbase/shared exec vitest run --coverage
```

## Order of work (recommended — priority-driven, matches tasks.md)

P1 first, then P2, then P3. Within P1, do `packages/shared` before `apps/api` so the RBAC matrix tests exist before api tests assert against it.

1. **`packages/shared`** (P1) — RBAC matrix iteration + zod schema accept/reject. Smallest surface, highest leverage; establishes helper patterns.
2. **`apps/api`** (P1) — auth plugin → RBAC plugin → error envelope → `/v1/*` integration via Fastify `inject()`. Depends on shared (RBAC).
3. **`apps/worker`** (P2) — pure classifier tests first (pooler drift); then provision pipeline with mocked docker-control + vault clients.
4. **`packages/db`** (P2) — extend existing `migration-idempotency.test.ts` + `port-allocator.test.ts`; add runner-internals tests.
5. **`apps/web`** (P3) — three smoke tests. Independent; no shared blockers.

## Per-package recipes

### `packages/shared`
```ts
// tests/rbac.test.ts (sketch)
import { describe, it, expect } from 'vitest';
import { rbacMatrix, can } from '../src/rbac';

describe('rbac matrix', () => {
  for (const [role, actions] of Object.entries(rbacMatrix)) {
    for (const [action, allowed] of Object.entries(actions)) {
      it(`${role} → ${action} = ${allowed}`, () => {
        expect(can(role, action)).toBe(allowed);
      });
    }
  }
});
```

### `apps/api`
```ts
// tests/integration/v1-database-query.test.ts (sketch)
import { buildApp } from '../helpers/app';

const app = await buildApp();
const res = await app.inject({
  method: 'POST',
  url: '/v1/projects/abc/database/query',
  headers: { authorization: `Bearer ${PAT}` },
  payload: { query: 'select 1' },
});
expect(res.statusCode).toBe(200);
```

### `apps/worker`
```ts
// tests/unit/jobs/pooler-reconciler.test.ts (sketch)
import { classifyDrift } from '../../../src/jobs/pooler-reconciler';
import fixtures from '../../fixtures/pooler-drift';

for (const { id, declared, observed, expected } of fixtures) {
  it(`drift class ${id}`, () => {
    expect(classifyDrift(declared, observed)).toBe(expected);
  });
}
```

### `packages/db`
```ts
// tests/port-allocator.test.ts — add concurrency block
it('allocates N unique ports under concurrency', async () => {
  const results = await Promise.all(Array.from({length: 16}, () => allocate()));
  expect(new Set(results).size).toBe(results.length);
});
```

### `apps/web`
```tsx
// tests/unit/Login.test.tsx (sketch)
import { render, screen, fireEvent } from '@testing-library/react';
import Login from '../../src/pages/Login';

it('submits credentials', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  render(<Login />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  expect(fetchSpy).toHaveBeenCalled();
});
```

## Verifying done

```bash
pnpm test:coverage     # all targets met
pnpm lint              # no new prod `any`
pnpm typecheck         # green
```

Then per [contracts/coverage-targets.md](./contracts/coverage-targets.md), check each Target and Regression-guard row in the printed table.

## What NOT to do

- Don't add `coverage.thresholds` to vitest configs (out of scope; would create a soft CI gate).
- Don't refactor production code only to make it testable (FR-006).
- Don't introduce testcontainers, Jest, Playwright, or any new test runner (FR-009).
- Don't extend `tests/cli-e2e/*.sh` for coverage (out of scope).
- Don't snapshot the RBAC matrix or zod schemas — assert behavior, not output (research.md).
