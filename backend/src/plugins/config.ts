// Environment configuration: read once, validated with Zod, immutable afterwards.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Every variable of `.env.example` is accounted for here, and the accounting is
// split in two on purpose:
//
//   - `SERVICE_ENV_VARS` are the variables the two Node processes read. They are
//     validated by the schema below, and a malformed value aborts start-up rather
//     than surfacing as a mystery three layers down.
//   - `INFRASTRUCTURE_ENV_VARS` are the variables that belong to Compose, to the
//     host tooling and to the seed. The process never reads them, so requiring
//     them would make the backend refuse to boot because Grafana has no password,
//     which is a failure mode with no upside.
//
// A unit test asserts that the union of the two lists is exactly the set of
// variables declared in `.env.example`. That is a stronger guarantee than "the
// process refuses to start when one is missing": adding a variable to the template
// without deciding who reads it fails the suite, and no variable can be silently
// ignored.
//
// Three variables have no default and abort start-up when absent: `DATABASE_URL`,
// `REDIS_URL` and `JWT_SECRET`. Everything else carries the default of
// `.env.example`, so a value that is missing is a documented decision and not an
// accident.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  DEFAULT_GAME_RATE,
  SCHEDULE_HORIZON_REAL_MS,
  ACCESS_TOKEN_TTL_REAL_MS,
} from '../shared/index.js';

// ---------------------------------------------------------------------------
// The variables of .env.example
// ---------------------------------------------------------------------------

/** Variables the server and the worker read. Validated by `appConfigSchema`. */
export const SERVICE_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_ACCESS_TTL',
  'REFRESH_TTL',
  'GAME_RATE_NUM',
  'GAME_RATE_DEN',
  'SCHEDULE_HORIZON_REAL_MS',
  'WORLD_SEED',
  'PORT',
  'LOG_LEVEL',
  'DEV_ENDPOINTS',
  'CORS_ORIGIN',
] as const;

/**
 * Variables of `.env.example` that no Node process reads. Each one says who does,
 * because "unused" and "used somewhere else" must not look the same.
 */
export const INFRASTRUCTURE_ENV_VARS = [
  // docker-compose.yml, and the DATABASE_URL of the host tooling.
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_PORT',
  // `prisma migrate diff --from-migrations`, which replays the history into it.
  'SHADOW_DATABASE_URL',
  // Published host ports. Only the in-container `PORT` reaches the code.
  'REDIS_PORT',
  'BACKEND_PORT',
  'HTTP_PORT',
  'HTTPS_PORT',
  'FRONTEND_DEV_PORT',
  // backend/prisma/seed.ts.
  'SEED_DEV_PLAYER',
  'SEED_DEV_PLAYER_EMAIL',
  'SEED_DEV_PLAYER_PASSWORD',
  // docker-compose.obs.yml, profile "obs".
  'PROMETHEUS_PORT',
  'GRAFANA_PORT',
  'GRAFANA_ADMIN_PASSWORD',
] as const;

/**
 * Variables the processes read that `.env.example` does not declare, because they
 * are injected by the compose files and never by the template.
 *
 * `METRICS_PORT` is the port of the metrics listener of the worker, which has no
 * HTTP surface of its own (docs/handoff/NOTES-W1.md, item 3);
 * `infra/prometheus/prometheus.yml` scrapes `worker:9464/metrics`. `NODE_ENV` and
 * `HOST` are conventions of the runtime.
 */
export const CONTAINER_ENV_VARS = ['NODE_ENV', 'HOST', 'METRICS_PORT'] as const;

// ---------------------------------------------------------------------------
// Coercions
// ---------------------------------------------------------------------------

/**
 * An integer that arrives as text. `z.coerce.number()` would accept `''` as zero
 * and `'1.5'` as 1.5, so the value is parsed explicitly instead.
 */
function integerEnv(options: {
  readonly min?: number;
  readonly max?: number;
}): z.ZodType<number, unknown> {
  return z
    .string()
    .trim()
    .min(1)
    .transform((text, ctx) => {
      const value = Number(text);
      if (!Number.isInteger(value)) {
        ctx.addIssue({ code: 'custom', message: `No es un entero: ${text}` });
        return z.NEVER;
      }
      if (options.min !== undefined && value < options.min) {
        ctx.addIssue({ code: 'custom', message: `Debe ser mayor o igual que ${options.min}` });
        return z.NEVER;
      }
      if (options.max !== undefined && value > options.max) {
        ctx.addIssue({ code: 'custom', message: `Debe ser menor o igual que ${options.max}` });
        return z.NEVER;
      }
      return value;
    });
}

/** A boolean that arrives as text. Only the two literal spellings are accepted. */
const booleanEnv = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Levels of Pino, in the order Pino itself declares them, plus `silent`.
 *
 * `.env.example` documents the six that are useful in an operating environment. `silent` is the
 * seventh Pino accepts and the integration suite uses it: a suite that prints one line per request
 * buries the failure that matters.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Value of `JWT_SECRET` in `.env.example`, refused outside development. */
export const DEVELOPMENT_JWT_SECRET = 'development-only-secret-replace-me';

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

/**
 * The shape of the configuration. Defaults mirror `.env.example` exactly; when the
 * default is a shared constant the constant is used, so that a change to
 * `shared/config` does not have to be mirrored here by hand.
 */
export const appConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),

  // --- PostgreSQL and Redis -------------------------------------------------
  databaseUrl: z.string().min(1, 'DATABASE_URL es obligatoria. Ver .env.example.'),
  redisUrl: z.string().min(1, 'REDIS_URL es obligatoria. Ver .env.example.'),

  // --- Authentication -------------------------------------------------------
  jwtSecret: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres.'),
  /** Lifetime of an access token, in real seconds. */
  jwtAccessTtlSeconds: integerEnv({ min: 60, max: 86_400 }).default(
    ACCESS_TOKEN_TTL_REAL_MS / 1000,
  ),
  /** Lifetime of a rotating refresh token, in real seconds. */
  refreshTtlSeconds: integerEnv({ min: 3600 }).default(2_592_000),

  // --- Game clock -----------------------------------------------------------
  gameRateNum: integerEnv({ min: 0 }).default(DEFAULT_GAME_RATE.rateNum),
  gameRateDen: integerEnv({ min: 1 }).default(DEFAULT_GAME_RATE.rateDen),
  scheduleHorizonRealMs: integerEnv({ min: 1000 }).default(SCHEDULE_HORIZON_REAL_MS),

  // --- World ----------------------------------------------------------------
  worldSeed: integerEnv({ min: -2_147_483_648, max: 2_147_483_647 }).default(20_260_811),

  // --- HTTP service ---------------------------------------------------------
  port: integerEnv({ min: 1, max: 65_535 }).default(3000),
  host: z.string().min(1).default('0.0.0.0'),
  metricsPort: integerEnv({ min: 1, max: 65_535 }).default(9464),
  logLevel: z.enum(LOG_LEVELS).default('info'),
  devEndpoints: booleanEnv.default(false),
  corsOrigins: z
    .string()
    .default('http://localhost:3100,http://localhost:8080')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
});

/** The configuration as the rest of the backend sees it: readonly, fully resolved. */
export type AppConfig = Readonly<z.infer<typeof appConfigSchema>> & {
  /** True when the process must refuse anything that is only safe in development. */
  readonly isProduction: boolean;
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Loads the single `.env` of the repository root, if there is one.
 *
 * The same mechanism and the same argument as `backend/prisma.config.ts` and
 * `backend/prisma/seed.ts`: `process.loadEnvFile` is part of Node 22 and, like `--env-file`,
 * never overwrites a variable that is already set. So it is inert inside the containers and in
 * CI, where the environment arrives from outside and there is no file, and it is what makes
 * `npx tsx src/server.ts` work from `backend/` the way `make seed` does.
 *
 * The path is resolved from the location of this file and not from the working directory,
 * because the commands are invoked as `cd backend && ...`.
 */
export function loadRepositoryEnvFile(): void {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

/** The environment as an untyped bag, so that tests can supply their own. */
export type RawEnv = Readonly<Record<string, string | undefined>>;

/** Only the keys the schema reads, mapped from their environment names. */
function shape(env: RawEnv): Record<string, unknown> {
  const present = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value.length === 0 ? undefined : value;
  };
  return {
    nodeEnv: present('NODE_ENV'),
    databaseUrl: present('DATABASE_URL'),
    redisUrl: present('REDIS_URL'),
    jwtSecret: present('JWT_SECRET'),
    jwtAccessTtlSeconds: present('JWT_ACCESS_TTL'),
    refreshTtlSeconds: present('REFRESH_TTL'),
    gameRateNum: present('GAME_RATE_NUM'),
    gameRateDen: present('GAME_RATE_DEN'),
    scheduleHorizonRealMs: present('SCHEDULE_HORIZON_REAL_MS'),
    worldSeed: present('WORLD_SEED'),
    port: present('PORT'),
    host: present('HOST'),
    metricsPort: present('METRICS_PORT'),
    logLevel: present('LOG_LEVEL'),
    devEndpoints: present('DEV_ENDPOINTS'),
    corsOrigins: present('CORS_ORIGIN'),
  };
}

/** A configuration error, reported with every offending variable at once. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `La configuracion del entorno no es valida:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Maps a Zod path back to the environment variable it came from. */
const ENV_NAME_BY_FIELD: Readonly<Record<string, string>> = {
  nodeEnv: 'NODE_ENV',
  databaseUrl: 'DATABASE_URL',
  redisUrl: 'REDIS_URL',
  jwtSecret: 'JWT_SECRET',
  jwtAccessTtlSeconds: 'JWT_ACCESS_TTL',
  refreshTtlSeconds: 'REFRESH_TTL',
  gameRateNum: 'GAME_RATE_NUM',
  gameRateDen: 'GAME_RATE_DEN',
  scheduleHorizonRealMs: 'SCHEDULE_HORIZON_REAL_MS',
  worldSeed: 'WORLD_SEED',
  port: 'PORT',
  host: 'HOST',
  metricsPort: 'METRICS_PORT',
  logLevel: 'LOG_LEVEL',
  devEndpoints: 'DEV_ENDPOINTS',
  corsOrigins: 'CORS_ORIGIN',
};

/**
 * Reads and validates the configuration. Throws `ConfigError` listing every
 * offending variable, because fixing them one boot at a time is the slowest
 * possible way to configure a service.
 *
 * Two cross field rules are checked after the schema, since neither is a property
 * of a single variable:
 *
 *   1. The development secret of `.env.example` is refused with
 *      `NODE_ENV=production`. A known signing key is not a configuration detail.
 *   2. The development endpoints are refused with `NODE_ENV=production` as well,
 *      which is the second of the two guards of plan section 7; the first is the
 *      flag itself.
 */
export function loadConfig(env: RawEnv = process.env): AppConfig {
  const parsed = appConfigSchema.safeParse(shape(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = typeof issue.path[0] === 'string' ? issue.path[0] : '(desconocida)';
      const name = ENV_NAME_BY_FIELD[field] ?? field;
      return `${name}: ${issue.message}`;
    });
    throw new ConfigError(issues);
  }

  const value = parsed.data;
  const isProduction = value.nodeEnv === 'production';
  const crossFieldIssues: string[] = [];
  if (isProduction && value.jwtSecret === DEVELOPMENT_JWT_SECRET) {
    crossFieldIssues.push(
      'JWT_SECRET: el valor de .env.example no se admite con NODE_ENV=production.',
    );
  }
  if (isProduction && value.devEndpoints) {
    crossFieldIssues.push('DEV_ENDPOINTS: no se admite true con NODE_ENV=production.');
  }
  if (crossFieldIssues.length > 0) {
    throw new ConfigError(crossFieldIssues);
  }

  return Object.freeze({ ...value, isProduction });
}
