import { defineConfig } from 'vitest/config';

// Root `tests/` project (feature 023). Node environment so cross-cutting /
// infra-contract tests can read repo files without a per-file
// `// @vitest-environment node` override. Registered in vitest.workspace.ts so
// `pnpm test` collects tests/integration/* (previously dormant) plus any new
// integration / contract test placed under tests/.
export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
