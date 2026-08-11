import { defineConfig } from 'vitest/config';

// Unit tests of the shared rules. They run only against this directory, never
// against the synchronised copies under backend/src/shared or
// frontend/app/shared (plan section 4).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    exclude: ['node_modules/**'],
    // Property-based tests with fast-check need room: the terrain determinism
    // suite walks a thousand chunks (plan section 8).
    testTimeout: 30_000,
    globals: false,
    reporters: ['default'],
  },
});
