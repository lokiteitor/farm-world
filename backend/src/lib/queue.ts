// The domain queue: one queue, seven named jobs, one predeclared handler registry.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// One queue and not seven. A queue in BullMQ is a Redis key space plus a worker loop, and
// seven of them would mean seven blocking connections and seven independent orderings for
// facts that belong to the same player. What distinguishes the work is the job name,
// which is what the metrics, the retry policy and the log key off (plan section 6.4).
//
// The seven names are declared here in full, including the ones whose domain effect is
// written by a later workflow, because a name that appears when its module lands would
// mean a queue whose contents cannot be reasoned about until the last workflow. Each name
// resolves to a handler in the registry below; `src/handlers.ts` wires the domain ones to
// the module that owns them, so neither this file nor the registry has to be reopened
// (plan section 11, rule 3).
//
// Redis is an alarm clock and nothing else. The authoritative list of what must happen is
// `scheduled_events` in PostgreSQL, so losing the queue loses punctuality and never a
// fact: `sim.reconcile` re-enqueues everything already due, at start-up and periodically.
// That is why BullMQ is a requirement of punctuality and not of correctness.

import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { type AppConfig } from '../plugins/config.js';
import { redisOptions, type RedisLogger } from '../plugins/redis.js';
import { MIN_JOB_DELAY_REAL_MS, ScheduledEventKind } from '../shared/index.js';

/** Name of the queue. The prefix keeps a shared Redis legible. */
export const QUEUE_NAME = 'domain';

/** Key prefix of BullMQ. Parameterised so an integration test isolates itself. */
export const DEFAULT_QUEUE_PREFIX = 'farm-world:bull';

// ---------------------------------------------------------------------------
// Job names
// ---------------------------------------------------------------------------

/**
 * The seven jobs of plan section 6.4, with the exact names the plan gives them.
 *
 * Six of them are the arrival of a due `ScheduledEvent` and carry its identifier; the
 * seventh is the reconciliation sweep, which has no domain row because it is about the
 * queue itself.
 */
export const JobName = {
  TASK_COMPLETE: 'task.complete',
  FIELD_ADVANCE_PHASE: 'field.advancePhase',
  MACHINE_REPAIR_COMPLETE: 'machine.repairComplete',
  PLAYER_SETTLE_SWEEP: 'player.settleSweep',
  WORKER_POOL_REFRESH: 'workerPool.refresh',
  FOREST_NOTIFY_MILESTONE: 'forest.notifyMilestone',
  SIM_RECONCILE: 'sim.reconcile',
} as const;
export type JobName = (typeof JobName)[keyof typeof JobName];
export const JOB_NAMES: readonly JobName[] = Object.values(JobName);

/**
 * The job name of a kind of scheduled event. Exhaustive by construction: the record is
 * keyed by the union, so a new kind does not compile until it has a name.
 */
export const JOB_NAME_BY_EVENT_KIND: Readonly<Record<ScheduledEventKind, JobName>> = {
  [ScheduledEventKind.TASK_COMPLETE]: JobName.TASK_COMPLETE,
  [ScheduledEventKind.FIELD_ADVANCE_PHASE]: JobName.FIELD_ADVANCE_PHASE,
  [ScheduledEventKind.MACHINE_REPAIR_COMPLETE]: JobName.MACHINE_REPAIR_COMPLETE,
  [ScheduledEventKind.PLAYER_SETTLE_SWEEP]: JobName.PLAYER_SETTLE_SWEEP,
  [ScheduledEventKind.WORKER_POOL_REFRESH]: JobName.WORKER_POOL_REFRESH,
  [ScheduledEventKind.FOREST_NOTIFY_MILESTONE]: JobName.FOREST_NOTIFY_MILESTONE,
};

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * The payload of a due event. Minimal by rule (plan section 6.4): identifiers, the due
 * instant and the epoch. Never an amount, a quantity or a duration, all of which would
 * have been computed in the past and would be wrong by the time the job runs.
 *
 * `dueGameMs` travels as a decimal string, because a JSON payload has no integer type and
 * a game instant is a `bigint`.
 */
export interface ScheduledJobData {
  readonly scheduledEventId: string;
  readonly playerId: string;
  readonly kind: ScheduledEventKind;
  readonly dueGameMs: string;
  readonly epoch: number;
}

/** The payload of the reconciliation sweep. */
export interface ReconcileJobData {
  readonly reason: 'startup' | 'periodic' | 'manual';
}

export type JobPayload = ScheduledJobData | ReconcileJobData;

/** A job as a handler receives it. */
export type DomainJob = Job<JobPayload, void, JobName>;

/** What a handler does. Throwing asks BullMQ for a retry with backoff. */
export type JobHandler = (job: DomainJob) => Promise<void>;

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * The handler of every name, predeclared.
 *
 * A name with no handler is not an error at registration time and is one at run time: the
 * queue must be describable before every module exists, and a job that arrives for a name
 * nobody claimed must be loud rather than silently dropped. `missingHandlers` is what the
 * start-up of the worker logs, so the gap is visible from the first line of the log
 * instead of at the first job.
 */
export interface JobRegistry {
  register(name: JobName, handler: JobHandler): void;
  handlerFor(name: JobName): JobHandler | undefined;
  readonly missingHandlers: readonly JobName[];
  readonly registeredHandlers: readonly JobName[];
}

export function createJobRegistry(): JobRegistry {
  const handlers = new Map<JobName, JobHandler>();
  return {
    register(name, handler) {
      handlers.set(name, handler);
    },
    handlerFor(name) {
      return handlers.get(name);
    },
    get missingHandlers() {
      return JOB_NAMES.filter((name) => !handlers.has(name));
    },
    get registeredHandlers() {
      return JOB_NAMES.filter((name) => handlers.has(name));
    },
  };
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * Retries with exponential backoff, and both histories kept.
 *
 * Five attempts with a base of one second reaches sixteen seconds, which covers a
 * PostgreSQL failover and a deadlock without turning a permanent failure into an endless
 * loop. Completed jobs are kept for an hour and failed ones for a day, because a failed
 * job is the only trace of what a handler could not do, and losing it means debugging a
 * simulation with no evidence.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400, count: 5000 },
};

/** Jobs processed at a time by one worker process. Below the connection pool. */
export const QUEUE_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** The producing side, plus the connection it owns. */
export interface DomainQueue {
  readonly queue: Queue<JobPayload, void, JobName>;
  readonly prefix: string;
  /** Adds a job with a deterministic identifier, so adding it twice is a no-op. */
  add(name: JobName, jobId: string, payload: JobPayload, delayRealMs: number): Promise<void>;
  /** Removes a job by identifier. Silent when it is gone, which is the common case. */
  remove(jobId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Builds the producing side. The connection is dedicated: BullMQ issues blocking commands
 * and requires `maxRetriesPerRequest: null`, so sharing the command connection of
 * `plugins/redis.ts` would make an ordinary command wait behind a five second block.
 */
export function createDomainQueue(
  config: AppConfig,
  logger: RedisLogger,
  options: { readonly prefix?: string } = {},
): DomainQueue {
  const prefix = options.prefix ?? DEFAULT_QUEUE_PREFIX;
  const connection = new Redis(config.redisUrl, redisOptions('queue', logger));
  connection.on('error', (error: Error) => {
    logger.warn({ err: error, role: 'queue' }, 'redis connection error');
  });
  const queue = new Queue<JobPayload, void, JobName>(QUEUE_NAME, {
    connection,
    prefix,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  return {
    queue,
    prefix,
    async add(name, jobId, payload, delayRealMs) {
      await queue.add(name, payload, {
        jobId,
        // The floor keeps a handler that re-enqueues from spinning on a job with no
        // delay at all (`MIN_JOB_DELAY_REAL_MS` of shared/config/time.ts).
        delay: Math.max(delayRealMs, MIN_JOB_DELAY_REAL_MS),
      });
    },
    async remove(jobId) {
      const job = await queue.getJob(jobId);
      if (job !== undefined) {
        await job.remove().catch(() => undefined);
      }
    },
    async close() {
      await queue.close();
      await connection.quit().catch(() => undefined);
    },
  };
}

/** A logger with the levels the worker loop uses. */
export interface QueueLogger extends RedisLogger {
  error(object: Record<string, unknown>, message: string): void;
  debug(object: Record<string, unknown>, message: string): void;
}

/**
 * Builds the consuming side. The processor looks the handler up by name on every job
 * rather than closing over the registry contents, so a handler registered after the
 * worker started is still used, which is what makes the wiring order in `handlers.ts`
 * irrelevant.
 */
export function createQueueWorker(options: {
  readonly config: AppConfig;
  readonly registry: JobRegistry;
  readonly logger: QueueLogger;
  readonly prefix?: string;
  readonly concurrency?: number;
  readonly onProcessed?: (name: JobName) => void;
  readonly onFailed?: (name: JobName) => void;
}): { readonly worker: Worker<JobPayload, void, JobName>; close(): Promise<void> } {
  const prefix = options.prefix ?? DEFAULT_QUEUE_PREFIX;
  const connection = new Redis(options.config.redisUrl, redisOptions('worker', options.logger));
  connection.on('error', (error: Error) => {
    options.logger.warn({ err: error, role: 'worker' }, 'redis connection error');
  });

  const worker = new Worker<JobPayload, void, JobName>(
    QUEUE_NAME,
    async (job) => {
      const handler = options.registry.handlerFor(job.name);
      if (handler === undefined) {
        // Not a retry: no amount of waiting registers a handler. The job fails once,
        // stays in the failed set as evidence and does not consume five attempts.
        throw new Error(`No handler registered for the job ${job.name}`);
      }
      await handler(job);
      options.onProcessed?.(job.name);
    },
    {
      connection,
      prefix,
      concurrency: options.concurrency ?? QUEUE_CONCURRENCY,
    },
  );

  worker.on('failed', (job, error) => {
    const name = (job?.name ?? 'unknown') as JobName;
    options.onFailed?.(name);
    options.logger.error(
      { job: name, jobId: job?.id, attempts: job?.attemptsMade, err: error },
      'queue job failed',
    );
  });
  worker.on('error', (error) => {
    options.logger.warn({ err: error }, 'queue worker error');
  });

  return {
    worker,
    async close() {
      await worker.close();
      await connection.quit().catch(() => undefined);
    },
  };
}
