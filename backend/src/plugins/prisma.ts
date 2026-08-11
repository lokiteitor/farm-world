// The PostgreSQL client: one per process, with the pg driver adapter.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Prisma 7 removed the binary query engine and requires a driver adapter to
// construct a client: `new PrismaClient()` does not compile and `datasourceUrl` no
// longer exists (backend/prisma/README.md, section 2). The adapter is
// `@prisma/adapter-pg`, which takes a `pg.PoolConfig`, so the pool is sized here and
// not left to the default of ten.
//
// Sizing. The pool has to be above the write concurrency of the process, because
// every write path of plan section 6.3 holds a connection for the length of an
// interactive transaction: it locks the player row, settles accruals, applies domain
// effects and commits. If the pool were at or below that number, a transaction would
// wait for a connection while holding a lock, which turns a slow query into a
// deadlock-shaped outage. The worker runs `QUEUE_CONCURRENCY` jobs at a time and the
// server serves HTTP requests, so both get the same generous ceiling; PostgreSQL is
// configured for far more than this.
//
// This module is a plain function and not a Fastify plugin. Without `fastify-plugin`,
// which `backend/package.json` does not declare, a plugin registered with
// `app.register` gets its own encapsulation context and its decorators would be
// invisible to the routes; a function that decorates the root instance has no such
// trap. Every other plugin of this directory follows the same shape.

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { type AppConfig } from './config.js';

/** A minimal logger, so this module does not depend on the shape of Fastify's. */
export interface PoolLogger {
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

/**
 * Connections in the pool. Above the write concurrency of either process, and far
 * below `max_connections` of PostgreSQL, so that two processes plus the host tooling
 * plus a test run coexist.
 */
export const POOL_MAX_CONNECTIONS = 20;

/** How long an idle connection is kept. Short, so a restarted database is noticed. */
export const POOL_IDLE_TIMEOUT_MS = 30_000;

/** How long a caller waits for a connection before failing loudly. */
export const POOL_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Builds the client. The pool errors are routed to the logger instead of the default
 * behaviour of an unhandled `error` event on the pool, which takes the process down
 * when PostgreSQL closes an idle connection.
 */
export function createPrismaClient(config: AppConfig, logger: PoolLogger): PrismaClient {
  const adapter = new PrismaPg(
    {
      connectionString: config.databaseUrl,
      max: POOL_MAX_CONNECTIONS,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
      // Statement timeout inside PostgreSQL, as a last resort against a query that
      // holds the player lock forever. Well above the slowest legitimate
      // transaction, which is the spawn allocation of a registration.
      statement_timeout: 30_000,
    },
    {
      onPoolError: (error) => {
        logger.error({ err: error }, 'postgres pool error');
      },
      onConnectionError: (error) => {
        logger.warn({ err: error }, 'postgres connection error');
      },
    },
  );
  return new PrismaClient({ adapter });
}

/**
 * Whether PostgreSQL answers. Used by `/health`, which reports `down` when it does
 * not: losing PostgreSQL is not survivable, unlike losing Redis.
 */
export async function pingPostgres(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Closes the client. Idempotent, so a double signal does not throw. */
export async function disconnectPrisma(prisma: PrismaClient): Promise<void> {
  await prisma.$disconnect();
}
