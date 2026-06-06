import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tests',
    include: ['**/*.test.ts'],
    root: '/Users/lord/Code/superbase/tests',
    environment: 'node',
    globals: false,
  },
});
