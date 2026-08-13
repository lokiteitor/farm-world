// HTTP and WebSocket entry point.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3. Replaces the W1 scaffolding.
//
// The process does five things and delegates everything else:
//
//   1. Reads and validates the configuration, which fails loudly and with every offending
//      variable at once (`plugins/config.ts`).
//   2. Builds the services: the logger, the metrics, the PostgreSQL client, the two Redis
//      connections and the producing side of the queue (`lib/context.ts`).
//   3. Verifies the persisted world against the constants of `shared/config` and re-anchors the
//      clock when the configured multiplier differs. A generator version or a chunk size that
//      does not match aborts the boot: reinterpreting coordinates that already carry owned land
//      is worse than refusing to start (plan section 5.1).
//   4. Builds the application and listens.
//   5. Shuts down in order, which for this process means: stop accepting, close the sockets with
//      a code the client understands as "reconnect", then the queue, then Redis, then
//      PostgreSQL. Closing PostgreSQL first would make every in flight request fail on its way
//      out for no reason.
//
// It does not consume the queue. That is `worker.ts`, the second entry point of the same project
// (plan section 2.1): one image, one dependency tree, two compose services distinguished only by
// their command.

import process from 'node:process';
import { pino } from 'pino';
import { buildApp } from './app.js';
import { registerDomainHandlers } from './handlers.js';
import { createServiceContext } from './lib/context.js';
import { createDomainQueue } from './lib/queue.js';
import { rescheduleHorizon } from './lib/scheduler.js';
import { ConfigError, loadConfig, loadRepositoryEnvFile } from './plugins/config.js';
import { loggerOptions } from './plugins/logger.js';
import { createMetrics } from './plugins/metrics.js';
import { createPrismaClient, disconnectPrisma } from './plugins/prisma.js';
import { closeRedisConnections, createRedisConnections } from './plugins/redis.js';
import { WS_CLOSE_CODES } from './shared/index.js';

/** How long the process waits for the pieces to close before it exits anyway. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  const startedAtRealMs = BigInt(Date.now());
  // Inert in a container and in CI, where the environment arrives from outside; it is what makes
  // running this file directly from `backend/` behave like `make seed`.
  loadRepositoryEnvFile();
  const config = loadConfig();
  const logger = pino(loggerOptions(config, 'server'));
  const metrics = createMetrics('server');

  const prisma = createPrismaClient(config, logger);
  const redis = createRedisConnections(config, logger);
  const queue = createDomainQueue(config, logger);
  const services = createServiceContext({
    role: 'server',
    config,
    logger,
    prisma,
    redis,
    queue,
    metrics,
  });

  registerDomainHandlers(services);

  const startup = await services.clock.verifyOnStartup(
    { rateNum: config.gameRateNum, rateDen: config.gameRateDen },
    { applyRateFromConfig: config.gameRateApplyOnBoot },
  );
  if (startup.retimed) {
    const rescheduled = await rescheduleHorizon(services.schedulerDeps);
    logger.info({ rescheduled }, 'horizon rescheduled after the start-up re-anchoring');
  }
  logger.info(
    {
      worldId: startup.reading.world.id,
      seed: startup.reading.world.seed,
      gameNow: startup.reading.gameNow.toString(),
      rate: `${startup.reading.world.rateNum}/${startup.reading.world.rateDen}`,
      paused: startup.reading.paused,
    },
    'world clock read',
  );

  const app = await buildApp({ services, startedAtRealMs });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error({ signal }, 'shutdown timed out, exiting anyway');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    try {
      // The clients are told to come back rather than being cut off: the code is in the
      // application range and the client reconnects with backoff (`shared/ws`).
      app.wsHub.closeAll(WS_CLOSE_CODES.SHUTTING_DOWN, 'server shutting down');
      await app.close();
      await queue.close();
      await closeRedisConnections(redis);
      await disconnectPrisma(prisma);
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
  process.on('unhandledRejection', (reason) => {
    // Logged and not swallowed silently: an unhandled rejection is a bug, and the process stays
    // up because dropping every live session over one of them is a worse outcome.
    logger.error({ err: reason }, 'unhandled rejection');
  });

  await app.listen({ port: config.port, host: config.host });
  logger.info(
    { port: config.port, host: config.host, devEndpoints: config.devEndpoints },
    'listening',
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigError) {
    // The configuration is reported without the logger: it may be the very thing that is
    // malformed, and a stack trace would bury the list of variables to fix.
    console.error(error.message);
  } else {
    console.error('server failed to start');
    console.error(error);
  }
  process.exit(1);
}
