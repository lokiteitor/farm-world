import { defineConfig } from 'vitest/config';

// Integration tests against a real PostgreSQL and a real Redis.
//
// Containers come from testcontainers with ephemeral ports so that several
// agents can run the suite at the same time on one machine (plan section 10).
// A single worker keeps the concurrency cases deterministic: the suites that
// exercise the hard constraints of plan section 5.4 drive their own concurrency
// inside the test, and a second worker process racing on the same database would
// turn a real assertion into a flaky one.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.int.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    globals: false,
    // Container start-up plus migrations on a cold image.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
