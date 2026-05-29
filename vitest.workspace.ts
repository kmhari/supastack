import { defineWorkspace } from 'vitest/config';

// Glob-based — picks up packages/* and apps/* as they land. Apps/packages
// without a vitest config are skipped quietly by Vitest. The explicit
// ./tests/vitest.config.ts adds the root tests/ project (feature 023) so
// integration / infra-contract tests under tests/ are collected by `pnpm test`.
export default defineWorkspace(['packages/*', 'apps/*', './tests/vitest.config.ts']);
