// Simulation worker entry point.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3. Replaces the W1 scaffolding, which
// logged one line and exited; the `restart: "no"` of the `worker` service of
// `docker-compose.yml` was there for that reason and now has to go back to `unless-stopped`
// (docs/handoff/NOTES-W1.md, item 4, requested again in `docs/handoff/NOTES-w3a.md`).
//
// It shares the project, the dependency tree and the image with `server.ts`: the only difference
// between the two compose services is the command (plan section 2.1). What differs at run time is
// what each one holds:
//
//   - This process consumes the domain queue, with the seven job names of plan section 6.4, and
//     runs the reconciliation sweep at start-up and every minute. That sweep is why losing the
//     contents of Redis loses nothing: the authoritative list of what must happen is
//     `scheduled_events` in PostgreSQL.
//   - It has no HTTP surface of its own, so it opens a minimal listener for `/metrics` and
//     `/health` only. `infra/prometheus/prometheus.yml` scrapes `worker:9464/metrics`, and until
//     this existed the target showed as down (docs/handoff/NOTES-W1.md, item 3).
//
// BullMQ is a requirement of punctuality and not of correctness: if this process is down, the
// first request of a player applies everything that fell due, because both processes register the
// same handlers through `src/handlers.ts` and both go through the one applier.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';
import { pino } from 'pino';
import { registerDomainHandlers } from './handlers.js';
import { createServiceContext, type ServiceContext } from './lib/context.js';
import { buildHealthReply, healthStatusCode } from './lib/health.js';
import { startReconcileTimer } from './lib/jobs.js';
import { createDomainQueue, createQueueWorker } from './lib/queue.js';
import { reconcile, rescheduleHorizon } from './lib/scheduler.js';
import { ConfigError, loadConfig, loadRepositoryEnvFile } from './plugins/config.js';
import { loggerOptions } from './plugins/logger.js';
import { createMetrics, renderMetrics } from './plugins/metrics.js';
import { createPrismaClient, disconnectPrisma } from './plugins/prisma.js';
import { closeRedisConnections, createRedisConnections } from './plugins/redis.js';
import { RECONCILE_INTERVAL_REAL_MS } from './shared/index.js';

/** How long the process waits for the pieces to close before it exits anyway. */
const SHUTDOWN_TIMEOUT_MS = 20_000;

/**
 * The metrics and health listener. Two paths and nothing else: it is not an API, and answering
 * 404 to everything else is what keeps it from becoming one.
 */
function createMetricsServer(
  services: ServiceContext,
  startedAtRealMs: bigint,
): ReturnType<typeof createServer> {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const path = (request.url ?? '/').split('?')[0];
      try {
        if (path === '/metrics') {
          const rendered = await renderMetrics(services.metrics);
          response.writeHead(200, { 'content-type': rendered.contentType });
          response.end(rendered.body);
          return;
        }
        if (path === '/health') {
          const body = await buildHealthReply(services, startedAtRealMs);
          response.writeHead(healthStatusCode(body), { 'content-type': 'application/json' });
          response.end(JSON.stringify(body));
          return;
        }
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No existe.' } }));
      } catch (error) {
        services.logger.warn({ err: error, path }, 'the metrics listener failed');
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Error interno.' } }),
        );
      }
    })();
  });
}

async function main(): Promise<void> {
  const startedAtRealMs = BigInt(Date.now());
  // Inert in a container and in CI, where the environment arrives from outside; it is what makes
  // running this file directly from `backend/` behave like `make seed`.
  loadRepositoryEnvFile();
  const config = loadConfig();
  const logger = pino(loggerOptions(config, 'worker'));
  const metrics = createMetrics('worker');

  const prisma = createPrismaClient(config, logger);
  const redis = createRedisConnections(config, logger);
  const queue = createDomainQueue(config, logger);
  const services = createServiceContext({
    role: 'worker',
    config,
    logger,
    prisma,
    redis,
    queue,
    metrics,
  });

  registerDomainHandlers(services);
  if (services.jobs.missingHandlers.length > 0) {
    // Not fatal, and loud: a job whose name has no handler fails once and stays in the failed
    // set as evidence, which is better than a process that refuses to start and therefore
    // applies nothing at all.
    logger.warn({ missing: services.jobs.missingHandlers }, 'job names with no handler');
  }

  const startup = await services.clock.verifyOnStartup({
    rateNum: config.gameRateNum,
    rateDen: config.gameRateDen,
  });
  if (startup.retimed) {
    const rescheduled = await rescheduleHorizon(services.schedulerDeps);
    logger.info({ rescheduled }, 'horizon rescheduled after the start-up re-anchoring');
  }

  const consumer = createQueueWorker({
    config,
    registry: services.jobs,
    logger,
    onProcessed: (name) => metrics.jobsProcessed.inc({ job: name }),
    onFailed: (name) => metrics.jobsFailed.inc({ job: name }),
  });

  // At start-up, before anything else: everything already due is enqueued in order, which is what
  // makes an outage of any length recoverable without operator action (plan section 6.4).
  const swept = await reconcile(services.schedulerDeps, 'startup');
  const timer = startReconcileTimer(services, RECONCILE_INTERVAL_REAL_MS);

  const metricsServer = createMetricsServer(services, startedAtRealMs);
  await new Promise<void>((resolve) => {
    metricsServer.listen(config.metricsPort, config.host, () => resolve());
  });

  logger.info(
    {
      metricsPort: config.metricsPort,
      concurrency: consumer.worker.opts.concurrency,
      jobHandlers: services.jobs.registeredHandlers,
      enqueuedAtStartup: swept.enqueuedEvents,
      pendingEvents: swept.pendingEvents,
      gameNow: startup.reading.gameNow.toString(),
    },
    'worker consuming the domain queue',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const guard = setTimeout(() => {
      logger.error({ signal }, 'shutdown timed out, exiting anyway');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    guard.unref();
    try {
      timer.stop();
      // The consumer first, and with its own close, which waits for the jobs in flight: killing
      // a job mid transaction is safe by design, since the transaction rolls back and the job is
      // redelivered, but waiting is free and keeps the log clean.
      await consumer.close();
      await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
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
    logger.error({ err: reason }, 'unhandled rejection');
  });
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error('worker failed to start');
    console.error(error);
  }
  process.exit(1);
}
