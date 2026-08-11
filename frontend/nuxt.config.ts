import { defineNuxtConfig } from 'nuxt/config';

// Nuxt configuration.
//
// Frozen after workflow W1 (plan section 11, rule 2). Single-page application:
// the server is authoritative (GDD section 54) and every view needs an
// authenticated session, so server-side rendering would buy nothing and would
// force a second execution environment for Phaser.
export default defineNuxtConfig({
  compatibilityDate: '2026-08-11',

  // No SSR: the build is static and Caddy serves it (stack section 7.1).
  ssr: false,

  // Sources live in app/, so that app/shared can hold the synchronised copy of
  // the repository-root shared/ directory (plan section 4).
  srcDir: 'app',

  modules: ['@pinia/nuxt'],

  css: ['~/assets/tokens.css'],

  devServer: {
    port: 3001,
    host: '0.0.0.0',
  },

  // Development proxy. The browser talks to a single origin, which keeps cookies
  // first-party: the rotating refresh token is an httpOnly cookie (stack
  // section 6) and a cross-origin dev setup would need SameSite=None.
  nitro: {
    devProxy: {
      '/api': {
        target: `${process.env.NUXT_PUBLIC_API_ORIGIN ?? 'http://localhost:3000'}/api`,
        changeOrigin: true,
      },
      '/ws': {
        target: `${(process.env.NUXT_PUBLIC_API_ORIGIN ?? 'http://localhost:3000').replace(/^http/, 'ws')}/ws`,
        changeOrigin: true,
        ws: true,
      },
    },
  },

  runtimeConfig: {
    public: {
      // Empty means "same origin", which is the production case: Caddy serves
      // the client and proxies /api and /ws.
      apiBase: '',
      wsPath: '/ws',
    },
  },

  typescript: {
    strict: true,
    // Type checking is a separate step (`npm run typecheck`, `make typecheck`)
    // so the dev server stays fast and CI keeps one failure per concern.
    typeCheck: false,
    // Nuxt already sets strict, noUncheckedIndexedAccess, verbatimModuleSyntax
    // and noImplicitOverride. These are the remaining options of
    // tsconfig.base.json, injected here because a solution-style tsconfig cannot
    // pass compilerOptions down to the generated projects.
    tsConfig: {
      compilerOptions: {
        exactOptionalPropertyTypes: true,
        noFallthroughCasesInSwitch: true,
        noImplicitReturns: true,
      },
    },
  },

  app: {
    head: {
      title: 'Farming Management Simulator Online',
      htmlAttrs: { lang: 'es' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'dark light' },
      ],
    },
  },

  vite: {
    // Phaser is large and has no meaningful tree shaking; keeping it in its own
    // chunk means a panel change does not invalidate it in the browser cache.
    // The bundler is rolldown, whose manualChunks only accepts a function.
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id: string) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
        },
      },
    },
  },
});
