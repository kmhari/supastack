import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Exclude the vendored theme — its upstream tests pull in deps we don't ship.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/theme/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.config.*', '**/theme/**', 'tests/e2e/**'],
    },
  },
});
