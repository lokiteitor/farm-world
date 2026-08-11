import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Component and logic tests of the client.
//
// Deliberately plain Vite plus @vitejs/plugin-vue instead of the Nuxt test
// runtime: the panels are tested against the mock server generated from the Zod
// schemas (plan section 10), which needs no Nuxt runtime, and a plain
// configuration keeps the suite fast and its failures readable. Phaser is not
// unit tested; its budget is verified in the measurement route (make perf-lab).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['app/**/__tests__/**/*.test.ts', 'app/**/*.test.ts'],
    exclude: ['node_modules/**', '.nuxt/**', '.output/**', 'app/shared/**'],
    globals: false,
  },
});
