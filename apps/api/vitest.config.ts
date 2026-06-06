import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
  },
});
