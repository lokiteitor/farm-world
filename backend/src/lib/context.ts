// The service context: the one object every later module receives.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// It assembles the pieces a domain path needs and hides the wiring between them. Two
// things make it worth existing rather than passing six arguments around:
//
//   - `transaction` is the only way in. It runs the body inside one interactive
//     transaction and flushes the outbox after the commit, so no module can reach the
//     queue or the pub/sub from inside a transaction (`lib/outbox.ts`).
//   - The flush is assembled here, which is why `lib/scheduler.ts` and `lib/pubsub.ts`
//     never import each other and neither of them imports this file.
//
// Both processes build one: `server.ts` for the HTTP and WebSocket surface, `worker.ts`
// for the queue consumer. They differ in the role reported to the metrics and in whether
// they hold a queue worker, and in nothing else, which is what "one project, two entry
// points" means (plan section 2.1).
//
// A failure of the flush never fails the request. The domain state is committed and
// correct; what was lost is punctuality, which the reconciliation sweep restores, and the
// liveness of one socket, which the sequence rule of plan section 7 repairs by replay. So
// every branch of the flush logs and continues.

import { type Logger } from 'pino';
import { type PrismaClient } from '../generated/prisma/client.js';
import { type AppConfig } from '../plugins/config.js';
import { type Metrics } from '../plugins/metrics.js';
import { keyBuilders, type RedisConnections, type RedisKeys } from '../plugins/redis.js';
import { pushRing } from './events.js';
import { GameClockService, type NowFn } from './gameClock.js';
import { type Outbox, type OutboxCollector, type OutboxFlush } from './outbox.js';
import { publishFrames } from './pubsub.js';
import { createJobRegistry, type DomainQueue, type JobRegistry } from './queue.js';
import { enqueueEffect, type SchedulerDeps } from './scheduler.js';
import { withTransaction, type Tx, type TransactionOptions } from './tx.js';

/** Everything a domain path can reach. */
export interface ServiceContext {
  readonly role: 'server' | 'worker';
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly prisma: PrismaClient;
  readonly redis: RedisConnections;
  readonly keys: RedisKeys;
  readonly queue: DomainQueue;
  readonly metrics: Metrics;
  readonly clock: GameClockService;
  /** The registry of queue job handlers, wired by `src/handlers.ts`. */
  readonly jobs: JobRegistry;
  /** What the scheduler needs to create an alarm clock. */
  readonly schedulerDeps: SchedulerDeps;
  /** One interactive transaction, with the outbox flushed after the commit. */
  transaction<T>(
    body: (tx: Tx, outbox: Outbox) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  /** Exposed for the two callers that flush without a transaction: the WebSocket and tests. */
  readonly flushOutbox: OutboxFlush;
}

export interface ServiceContextOptions {
  readonly role: 'server' | 'worker';
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly prisma: PrismaClient;
  readonly redis: RedisConnections;
  readonly queue: DomainQueue;
  readonly metrics: Metrics;
  /** Key prefix of Redis. Parameterised so an integration test isolates itself. */
  readonly keyPrefix?: string;
  /** The source of real time, injected so a test can fix it. */
  readonly now?: NowFn;
}

export function createServiceContext(options: ServiceContextOptions): ServiceContext {
  const keys = keyBuilders(options.keyPrefix);
  const clock = new GameClockService({
    prisma: options.prisma,
    worldSeed: options.config.worldSeed,
    logger: options.logger,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const schedulerDeps: SchedulerDeps = {
    prisma: options.prisma,
    queue: options.queue,
    clock,
    horizonRealMs: options.config.scheduleHorizonRealMs,
    logger: options.logger,
  };

  const flushOutbox: OutboxFlush = async (collector: OutboxCollector) => {
    for (const effect of collector.effects) {
      try {
        switch (effect.kind) {
          case 'enqueue':
            await enqueueEffect(schedulerDeps, effect);
            break;
          case 'removeJob':
            await options.queue.remove(effect.jobId);
            break;
          case 'publish': {
            // The ring first and the channel second. A client that receives the frame and
            // immediately asks for a replay must find the ring already holding it,
            // otherwise it would take the snapshot path for a gap that does not exist.
            await pushRing(options.redis.commands, keys, effect.playerId, effect.frames);
            const outcome = await publishFrames(
              options.redis.commands,
              keys,
              effect.playerId,
              effect.frames,
            );
            for (const frame of effect.frames.slice(0, outcome.published)) {
              options.metrics.wsFramesPublished.inc({ type: frame.type });
            }
            if (outcome.suppressed > 0) {
              options.metrics.wsFramesSuppressed.inc(outcome.suppressed);
            }
            break;
          }
          default: {
            // Exhaustiveness: a new kind of effect does not compile until it is handled.
            const unreachable: never = effect;
            throw new Error(`Unhandled outbox effect: ${JSON.stringify(unreachable)}`);
          }
        }
      } catch (error) {
        options.logger.warn(
          { err: error, effect: effect.kind },
          'the outbox flush failed after a successful commit',
        );
      }
    }
  };

  return {
    role: options.role,
    config: options.config,
    logger: options.logger,
    prisma: options.prisma,
    redis: options.redis,
    keys,
    queue: options.queue,
    metrics: options.metrics,
    clock,
    jobs: createJobRegistry(),
    schedulerDeps,
    transaction: (body, transactionOptions) =>
      withTransaction(options.prisma, flushOutbox, body, transactionOptions),
    flushOutbox,
  };
}
