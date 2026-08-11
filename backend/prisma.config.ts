// Prisma CLI configuration.
//
// Owner: workflow W2 (data schema). Frozen after W2.
//
// Prisma 7 no longer reads the datasource URL from `schema.prisma` and no longer
// loads `.env` by itself: the URL is supplied here, and the schema declares only
// the provider. This file is therefore part of the contract that every backend
// agent depends on, and the real shape of that contract, as found in 7.9.1, is:
//
//   - the config file lives at the root of the npm project (backend/), not inside
//     prisma/, and is discovered automatically by every `prisma` subcommand;
//   - `defineConfig` comes from `prisma/config`, which re-exports it from
//     `@prisma/config`;
//   - the accepted keys are `schema`, `migrations` (`path`, `seed`,
//     `initShadowDb`), `datasource` (`url`, `shadowDatabaseUrl`), `tables`,
//     `enums`, `views`, `typedSql` and `experimental`.
//
// Environment. The repository keeps a single `.env` at its root, because host
// tooling and the compose files share it (see .env.example). The Prisma CLI is
// invoked as `cd backend && npx prisma ...`, so the working directory is
// backend/ and no loader would find that file. It is loaded explicitly with
// `process.loadEnvFile`, which is built into Node 22 and, like `--env-file`,
// never overwrites a variable that is already set. That matters in CI and in the
// containers, where DATABASE_URL arrives from the environment and there is no
// `.env` file at all.
//
// `dotenv` is deliberately not used, although the official scaffolding suggests
// it: it is not declared in backend/package.json, which is frozen, and it would
// only reproduce what the runtime already provides.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const repositoryEnvFile = resolve(projectRoot, '..', '.env');

if (existsSync(repositoryEnvFile)) {
  process.loadEnvFile(repositoryEnvFile);
}

const databaseUrl = process.env['DATABASE_URL'];

// Optional. Prisma creates and drops a shadow database on its own when the
// connection user may do so, which is the case in development and in CI. An
// explicit URL is needed for two things: a managed database where the user cannot
// create databases, and `prisma migrate diff --from-migrations`, which replays the
// migration history into a shadow database and is how the idempotence of the
// history against the datamodel is verified (see backend/prisma/README.md).
const shadowDatabaseUrl = process.env['SHADOW_DATABASE_URL'];

// The datasource block is omitted when the variable is absent instead of being
// passed as undefined: `prisma validate`, `prisma format` and `prisma generate`
// need no database, and an empty URL would turn their clear "not set" message
// into a connection error. `exactOptionalPropertyTypes` also forbids assigning
// undefined to an optional property.
const datasource = {
  ...(databaseUrl === undefined ? {} : { url: databaseUrl }),
  ...(shadowDatabaseUrl === undefined ? {} : { shadowDatabaseUrl }),
};

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Used by `prisma migrate reset` and `prisma db seed`. `make seed` invokes
    // the same script through `npm run seed`, so both routes are identical and
    // the seed is idempotent.
    seed: 'tsx prisma/seed.ts',
  },
  ...(Object.keys(datasource).length === 0 ? {} : { datasource }),
});
