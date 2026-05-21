import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['**/*.{test,spec}.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'infra/supabase-template/**',
      'apps/web/src/theme/**',
      '**/theme/**', // catches vendored tests under any apps/*/src/theme
      'apps/web/tests/e2e/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.config.*'],
    },
  },
});
