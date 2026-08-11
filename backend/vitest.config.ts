import { defineConfig } from 'vitest/config';

// Unit tests of the backend: everything that needs neither PostgreSQL nor Redis.
// Integration tests live in vitest.int.config.ts because they have a different
// concurrency and timeout profile.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'src/**/__tests__/**/*.int.test.ts'],
    globals: false,
    testTimeout: 15_000,
  },
});
