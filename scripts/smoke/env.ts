// Where the smoke test runs, and with which clock.
//
// Owner: workflow W7-B. `scripts/smoke/**`.
//
// The scenario needs a stack it owns from end to end, because it changes the multiplier of the
// world and must put it back: plan section 10 asks for one game hour per ten real milliseconds
// so that the 325 hour cycle of GDD section 118 completes in seconds through the real delay of
// the queue, and leaving a development database running at 360 000x afterwards would be a side
// effect nobody asked for.
//
// So the ports are its own, searched upwards from 3220 and never the published ones of `.env`:
// a development machine already has something on 3000 and on 3100, and a smoke test that fights
// another project, or another workflow window, for a port fails for a reason that has nothing to
// do with the game.
//
// PostgreSQL and Redis are not started here. They are the two services `make smoke` raises with
// Compose before invoking this script, and they are shared with the rest of the tooling on
// purpose: the smoke test asserts against the real database of the project and not against a
// throwaway one.

import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Root of the repository, resolved from this file and never from the working directory. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const BACKEND_DIR = resolve(REPO_ROOT, 'backend');

/** The `tsx` of the backend, which is the interpreter the two entry points run under. */
export const TSX_BIN = resolve(BACKEND_DIR, 'node_modules', '.bin', 'tsx');

/**
 * Loads the single `.env` of the repository root, if there is one.
 *
 * Same mechanism and same argument as `backend/plugins/config.ts`: `process.loadEnvFile` never
 * overwrites a variable that is already set, so an environment supplied from outside, as CI
 * does, wins over the file.
 */
export function loadRepositoryEnvFile(): void {
  const file = resolve(REPO_ROOT, '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

/** A required variable of the environment, with the message a missing one deserves. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Falta ${name}. Copiar .env.example a .env (make bootstrap) antes de ejecutar make smoke.`,
    );
  }
  return value;
}

/** An integer variable with a fallback. */
function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} no es un entero: ${value}`);
  }
  return parsed;
}

/**
 * Multiplier the scenario runs under: 360 000 game milliseconds per real millisecond, that is
 * one game hour every ten real milliseconds (plan section 10, `.env.example`). It is not a
 * shortcut around the wait: every task and every crop phase is still an alarm clock in Redis
 * and a delayed job in BullMQ, and the only thing that changed is how much wall clock a game
 * hour is worth.
 */
export const SMOKE_RATE_NUM = 360_000;
export const SMOKE_RATE_DEN = 1;

export interface SmokeEnvironment {
  /** Port the smoke instance of the backend listens on. The first free one above 3220. */
  readonly backendPort: number;
  /** Port the smoke instance of the worker exposes `/health` and `/metrics` on. */
  readonly workerMetricsPort: number;
  readonly host: string;
  readonly baseUrl: string;
  readonly worldSeed: number;
  /** Multiplier of `.env`, restored before the scenario gives the stack back. */
  readonly originalRateNum: number;
  readonly originalRateDen: number;
  /** Environment handed to the two child processes. */
  readonly childEnv: Readonly<Record<string, string>>;
  /** Level the two children log at. Raised with SMOKE_LOG_LEVEL when something has to be seen. */
  readonly logLevel: string;
}

/** Whether something is already listening on a port of the loopback interface. */
async function isPortBusy(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (value: boolean): void => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => {
      finish(true);
    });
    socket.once('error', () => {
      finish(false);
    });
    socket.setTimeout(1000, () => {
      finish(false);
    });
  });
}

/**
 * The first free port at or above `from`.
 *
 * The ports are searched and not fixed because the workflows of plan section 11 run several
 * agents at once on the same machine, and a fixed port turns "another window is running its own
 * stack" into a failure of this one, which says nothing about the game.
 */
async function allocatePort(host: string, from: number, taken: readonly number[]): Promise<number> {
  for (let port = from; port < from + 40; port += 1) {
    if (taken.includes(port)) {
      continue;
    }
    if (!(await isPortBusy(host, port))) {
      return port;
    }
  }
  throw new Error(`No hay ningun puerto libre entre ${String(from)} y ${String(from + 39)}.`);
}

/** Reads the environment of the run. Throws with an actionable message when it cannot. */
export async function readSmokeEnvironment(): Promise<SmokeEnvironment> {
  loadRepositoryEnvFile();

  const host = '127.0.0.1';
  const backendPort = await allocatePort(host, integer('SMOKE_BACKEND_PORT', 3220), []);
  const workerMetricsPort = await allocatePort(
    host,
    integer('SMOKE_WORKER_METRICS_PORT', backendPort + 1),
    [backendPort],
  );
  const logLevel = process.env['SMOKE_LOG_LEVEL'] ?? 'warn';
  const worldSeed = integer('WORLD_SEED', 20_260_811);

  const childEnv: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    NODE_ENV: 'development',
    DATABASE_URL: required('DATABASE_URL'),
    REDIS_URL: required('REDIS_URL'),
    JWT_SECRET: required('JWT_SECRET'),
    WORLD_SEED: String(worldSeed),
    HOST: host,
    PORT: String(backendPort),
    METRICS_PORT: String(workerMetricsPort),
    LOG_LEVEL: logLevel,
    // The two development routes the scenario uses are the two plan section 10 sanctions:
    // `dev/retime`, which sets the multiplier, and `dev/grant`, which sets a balance. Neither
    // is used to skip a wait; every completion the scenario asserts is a real delayed job.
    DEV_ENDPOINTS: 'true',
    GAME_RATE_NUM: String(SMOKE_RATE_NUM),
    GAME_RATE_DEN: String(SMOKE_RATE_DEN),
    // The one place in the repository that asks a boot to re-anchor the world from its own
    // configuration, and it asks for it explicitly. Since W7 that is not what a boot does by
    // default: the multiplier of a live world is domain state and only `retimeWorld` changes
    // it (ADR-0007). The run restores the multiplier of `.env` with `POST /api/dev/retime`
    // in its `finally`, which is the same domain operation from the other side.
    GAME_RATE_APPLY_ON_BOOT: 'true',
    SCHEDULE_HORIZON_REAL_MS: process.env['SCHEDULE_HORIZON_REAL_MS'] ?? '86400000',
    CORS_ORIGIN: `http://${host}:${String(backendPort)}`,
  };

  return {
    backendPort,
    workerMetricsPort,
    host,
    baseUrl: `http://${host}:${String(backendPort)}`,
    worldSeed,
    originalRateNum: integer('GAME_RATE_NUM', 12),
    originalRateDen: integer('GAME_RATE_DEN', 1),
    childEnv,
    logLevel,
  };
}
