// Flat ESLint configuration for the whole repository.
//
// Frozen after workflow W1 (plan section 11, rule 2). It already declares the
// zones of every module planned for later workflows, so no later agent needs to
// touch this file.
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import vuePlugin from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

// Backend domain modules (plan section 4). Each one is a zone: a module may
// import from its own directory, from ../../lib, ../../plugins and ../../shared,
// and from nothing else inside src/.
// Backend domain modules grouped by the workflow that authors them. Rule 4 of
// plan section 11 forbids imports between siblings *of the same phase*, because
// those are written concurrently and would deadlock on each other. A module of a
// later phase may import one of an earlier phase, which is already frozen: that
// is how `land`, `fields`, `farms` and `forestry` reach `world/service.ts`.
const BACKEND_MODULE_PHASES = [
  ['auth', 'world'],
  ['land', 'farms', 'fields'],
  ['machinery', 'workers', 'economy'],
  ['tasks', 'session', 'forestry'],
];

/**
 * One zone per module: it may import itself and every module authored in a
 * strictly earlier phase, and nothing else under modules/.
 */
const siblingModuleZones = BACKEND_MODULE_PHASES.flatMap((phase, phaseIndex) => {
  const earlier = BACKEND_MODULE_PHASES.slice(0, phaseIndex).flat();
  return phase.map((moduleName) => ({
    target: `./backend/src/modules/${moduleName}`,
    from: './backend/src/modules',
    except: [moduleName, ...earlier].map((name) => `./${name}`),
    message:
      'No imports between sibling backend modules of the same phase (plan section 11, ' +
      'rule 4). Import a module of an earlier phase, or move the shared piece to ' +
      'backend/src/lib or to shared/.',
  }));
});

export default tseslint.config(
  {
    // Generated, vendored or build output. Kept first so it applies globally.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      // Synchronised copies of shared/. Linting them would report the same
      // finding three times and they are not editable by hand.
      'backend/src/shared/**',
      'frontend/app/shared/**',
    ],
  },

  // ---------------------------------------------------------------------------
  // Baseline for every JavaScript and TypeScript file.
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { import: importPlugin },
    settings: {
      // The projects use NodeNext, so specifiers carry a .js extension that
      // only the TypeScript resolver can map back to the .ts source. Without
      // it the zone rules below would silently never fire.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          // Three separate npm projects, which is the point of the layout; the
          // resolver's advice to merge them into one does not apply here.
          noWarnOnMultipleProjects: true,
          project: ['tsconfig.json', 'shared/tsconfig.json', 'backend/tsconfig.json'],
        },
      },
    },
    rules: {
      // No implicit any and no unused code. `_`-prefixed parameters are the
      // documented escape hatch for interface conformance in stubs.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      // The comma operator. It is valid syntax, it type-checks, and it silently discards
      // everything but its last operand: `${(value / 100, 1)}` published the literal 1 in
      // the balance report for a whole workflow, where 147,64 belonged (W7, hallazgo H1 de
      // docs/revision-formulas.md). Nothing in this repository needs it.
      'no-sequences': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'import/no-duplicates': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // shared/ is the single source of truth: pure, deterministic, no I/O.
  // ---------------------------------------------------------------------------
  {
    files: ['shared/**/*.ts'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './shared',
              from: './backend',
              message: 'shared/ must not depend on the backend: it is imported by both sides.',
            },
            {
              target: './shared',
              from: './frontend',
              message: 'shared/ must not depend on the frontend: it is imported by both sides.',
            },
          ],
        },
      ],
      // The shared rules are pure by contract (plan section 8): no ambient
      // clock, no ambient randomness. Both are injected as parameters.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the deterministic integer hash of shared/world instead of Math.random.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Inject the clock: shared/ rules receive gameMs as a parameter.',
        },
      ],
    },
  },
  {
    // Test files may build fixtures freely.
    files: ['shared/**/__tests__/**/*.ts', '**/*.{test,spec}.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ---------------------------------------------------------------------------
  // Backend. Zone rules keep the modular monolith modular (plan section 11).
  // ---------------------------------------------------------------------------
  {
    files: ['backend/src/**/*.ts'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            ...siblingModuleZones,
            {
              // A module reaches outside itself only through lib, plugins and
              // the synchronised copy of shared.
              target: './backend/src/modules',
              from: './backend/src',
              except: ['./modules', './lib', './plugins', './shared'],
              message:
                'A backend module may only import from its own directory, ../../lib, ' +
                '../../plugins and ../../shared.',
            },
            {
              // lib/ is the lower layer: it must not know about modules.
              target: './backend/src/lib',
              from: './backend/src/modules',
              message: 'backend/src/lib is a lower layer than the domain modules.',
            },
            {
              target: './backend',
              from: './shared',
              message:
                'Import the synchronised copy under backend/src/shared, never the ' +
                'repository-root shared/ directory (plan section 4).',
            },
            {
              target: './backend',
              from: './frontend',
              message: 'The backend must not import from the frontend.',
            },
          ],
        },
      ],
    },
  },
  {
    // Domain modules never read an ambient clock or ambient randomness: the
    // request context carries gameMs and the world seed drives every draw.
    // backend/src/lib is exempt, because that is where the real clock and the
    // queue adapters legitimately live.
    files: ['backend/src/modules/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Inject the seeded generator: domain logic must be reproducible in tests.',
        },
        {
          object: 'Date',
          property: 'now',
          message:
            'Read the clock once per request in backend/src/lib/gameClock and propagate it as ' +
            'context (plan section 6.1).',
        },
      ],
    },
  },
  {
    // Entry points and the Prisma seed legitimately write to stdout.
    files: ['backend/src/server.ts', 'backend/src/worker.ts', 'backend/prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },

  // ---------------------------------------------------------------------------
  // Frontend. Vue SFCs with a TypeScript script block.
  // ---------------------------------------------------------------------------
  {
    files: ['frontend/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './frontend',
              from: './shared',
              message:
                'Import the synchronised copy under frontend/app/shared, never the ' +
                'repository-root shared/ directory (plan section 4).',
            },
            {
              target: './frontend',
              from: './backend',
              message: 'The frontend must not import from the backend.',
            },
            {
              // Phaser owns the canvas and never the server state (plan section 9).
              target: './frontend/app/game',
              from: './frontend/app/stores',
              message:
                'Phaser scenes must not import Pinia stores: state flows in through the ' +
                'scene bridge, and the canvas never mutates it.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['frontend/**/*.vue'],
    // "essential" and not "recommended": the extra tiers of the Vue preset are
    // largely formatting rules, and formatting belongs to Prettier. Two rules
    // from the upper tiers that are about structure, not layout, are enabled
    // explicitly below.
    extends: [...vuePlugin.configs['flat/essential']],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
    rules: {
      // Nuxt resolves components by file name, so multi-word names are noise
      // for pages and layouts but useful everywhere else.
      'vue/multi-word-component-names': 'off',
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/define-macros-order': 'error',
    },
  },

  // ---------------------------------------------------------------------------
  // Tooling files: configuration and scripts run in Node with dev dependencies.
  // ---------------------------------------------------------------------------
  {
    files: [
      '*.{js,mjs,cjs,ts}',
      'scripts/**/*.{js,mjs,cjs,ts}',
      'tools/**/*.ts',
      '**/*.config.{js,mjs,cjs,ts}',
      '**/nuxt.config.ts',
      '**/vitest.config.ts',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'import/no-restricted-paths': 'off',
    },
  },
);
