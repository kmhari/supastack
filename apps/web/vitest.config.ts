import { defineConfig } from 'vitest/config';

// Exclude the vendored theme — its upstream tests pull in deps we don't ship.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/theme/**', 'tests/e2e/**'],
  },
});
