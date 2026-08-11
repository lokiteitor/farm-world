// The queue handlers that belong to the simulation itself.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Six of the seven job names of plan section 6.4 mean the same thing to the queue: a
// `ScheduledEvent` of some player has fallen due. What differs between them is the domain
// effect, and that lives in the handler registry of `lib/advancePlayer.ts`, in the module
// that owns the domain. So one generic handler serves all six, and the job name survives
// as what it is genuinely useful for: a label on the metrics, a name in the log and a
// retry history that can be read per kind of work.
//
// The seventh, `sim.reconcile`, is the sweep itself.
//
// The due guard. Every handler re-checks the due instant against the clock, because a job
// can fire early after a retiming and because the payload was written in the past. Two
// cases, and neither of them loops:
//
//   - The world is paused. The event is parked: the alarm clock is dropped and nothing is
//     re-enqueued, because with `rateNum = 0` the instant is never reached and a
//     re-enqueue with any delay would spin.
//   - The world is running and the instant is still ahead. The row is marked as having no
//     alarm clock, and the reconciliation sweep creates a new one with the right delay on
//     its next pass. Re-enqueueing from inside the handler would have to invent a job
//     identifier to avoid colliding with the job that is still running, which is more
//     machinery for the same outcome one sweep period later.

import {
  DEFAULT_GAME_RATE,
  MIN_JOB_DELAY_REAL_MS,
  SETTLE_SWEEP_INTERVAL_REAL_MS,
  ScheduledEventKind,
  ScheduledEventStatus,
  gameMs as toGameMsValue,
  type GameMs,
  type PlayerId,
} from '../shared/index.js';
import { advancePlayer, type ScheduledEventContext } from './advancePlayer.js';
import { type ServiceContext } from './context.js';
import { scheduledEventDedupeKey } from './ids.js';
import {
  JobName,
  type DomainJob,
  type JobHandler,
  type ReconcileJobData,
  type ScheduledJobData,
} from './queue.js';
import { reconcile, scheduleEvent } from './scheduler.js';
import { lockPlayer } from './tx.js';

/** Whether a payload is the one the six domain jobs carry. */
function isScheduledJobData(payload: unknown): payload is ScheduledJobData {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as ScheduledJobData).scheduledEventId === 'string' &&
    typeof (payload as ScheduledJobData).playerId === 'string' &&
    typeof (payload as ScheduledJobData).dueGameMs === 'string'
  );
}

/**
 * The handler of the six domain jobs.
 *
 * It advances the player to the current game instant, which applies the event that woke it
 * up and anything else that fell due in the meantime, in order. It does not apply the
 * event by itself: there is one applier and this is not it (plan section 6.3).
 */
export function createAdvanceJobHandler(services: ServiceContext): JobHandler {
  return async (job: DomainJob): Promise<void> => {
    if (!isScheduledJobData(job.data)) {
      throw new TypeError(`The job ${job.name} did not carry a scheduled event payload`);
    }
    const data = job.data;
    const playerId = data.playerId as PlayerId;
    const dueGameMs = toGameMsValue(BigInt(data.dueGameMs));

    const reading = await services.clock.read();
    if (reading.gameNow < dueGameMs) {
      await parkEarlyEvent(services, data, reading.paused, dueGameMs);
      return;
    }

    await services.transaction(async (tx, outbox) => {
      const txReading = await services.clock.read(tx);
      const lock = await lockPlayer(tx, playerId);
      if (lock === null) {
        // The player was deleted, which cascades into `scheduled_events`. Nothing to do,
        // and not an error: a job outliving its player is expected at least once.
        services.logger.info(
          { playerId, scheduledEventId: data.scheduledEventId },
          'due event of a player that no longer exists',
        );
        return;
      }
      const result = await advancePlayer(services, tx, outbox, lock, txReading, txReading.gameNow);
      services.logger.debug(
        {
          job: job.name,
          playerId,
          processedEvents: result.processedEvents,
          truncated: result.truncated,
        },
        'due events applied',
      );
    });
  };
}

/** Drops the alarm clock of an event that is not due yet, so the sweep can recreate it. */
async function parkEarlyEvent(
  services: ServiceContext,
  data: ScheduledJobData,
  paused: boolean,
  dueGameMs: GameMs,
): Promise<void> {
  await services.prisma.scheduledEvent.updateMany({
    where: { id: data.scheduledEventId, status: ScheduledEventStatus.PENDING },
    data: { enqueuedAtRealMs: null, jobId: null },
  });
  services.logger.info(
    {
      scheduledEventId: data.scheduledEventId,
      kind: data.kind,
      dueGameMs: dueGameMs.toString(),
      paused,
    },
    paused
      ? 'due guard: the world is paused, the event is parked'
      : 'due guard: the event fired early and was returned to the sweep',
  );
}

/** The handler of `sim.reconcile`, for the development route and for an operator. */
export function createReconcileJobHandler(services: ServiceContext): JobHandler {
  return async (job: DomainJob): Promise<void> => {
    const reason = (job.data as ReconcileJobData).reason ?? 'manual';
    await reconcile(services.schedulerDeps, reason);
  };
}

// ---------------------------------------------------------------------------
// The periodic settlement sweep
// ---------------------------------------------------------------------------

/**
 * Period of the per player settlement sweep, in game time.
 *
 * `SETTLE_SWEEP_INTERVAL_REAL_MS` is 15 real minutes, which at the default multiplier is
 * six game hours. The period is fixed in game time and not converted through the current
 * multiplier, for two reasons: a game interval is what the domain reasons in, and a
 * conversion would divide by zero, or rather schedule the next sweep at the present
 * instant, in a paused world.
 */
export const SETTLE_SWEEP_PERIOD_GAME_MS: bigint =
  (BigInt(SETTLE_SWEEP_INTERVAL_REAL_MS) * BigInt(DEFAULT_GAME_RATE.rateNum)) /
  BigInt(DEFAULT_GAME_RATE.rateDen);

/**
 * An extension of the sweep. The forced liquidation of plan section 6.6 is one of these,
 * and it belongs to the economy module of workflow W5, which registers it here instead of
 * reopening this file (plan section 11, rule 3).
 */
export type SettleSweepHook = (context: ScheduledEventContext) => Promise<void>;

const settleSweepHooks: SettleSweepHook[] = [];

/** Registers an extension of the sweep. Order of registration is order of execution. */
export function registerSettleSweepHook(hook: SettleSweepHook): void {
  settleSweepHooks.push(hook);
}

/** Clears the hooks. For the tests, which must not inherit the registrations of another. */
export function resetSettleSweepHooks(): void {
  settleSweepHooks.length = 0;
}

/**
 * The handler of `PLAYER_SETTLE_SWEEP`.
 *
 * The settlement itself has already happened by the time this runs: `advancePlayer` settles
 * accruals up to the due instant of every event before applying it, which is the whole
 * point of the sweep. What is left is to run the registered extensions and to schedule the
 * next one, which is what keeps the chain alive per player without a global cron.
 *
 * It is deliberately the sweep and not the login that triggers a liquidation, so that it
 * never appears as a retroactive punishment for coming back (plan section 6.6).
 */
export async function settleSweepHandler(context: ScheduledEventContext): Promise<void> {
  for (const hook of settleSweepHooks) {
    await hook(context);
  }
  await scheduleNextSettleSweep(context);
}

/** Schedules the next sweep of a player, one period ahead of the one that just ran. */
export async function scheduleNextSettleSweep(context: ScheduledEventContext): Promise<void> {
  const nextDue = toGameMsValue(context.event.dueGameMs + SETTLE_SWEEP_PERIOD_GAME_MS);
  await scheduleEvent(context.tx, context.outbox, context.reading, {
    playerId: context.lock.playerId,
    kind: ScheduledEventKind.PLAYER_SETTLE_SWEEP,
    dueGameMs: nextDue,
    refType: 'PLAYER',
    refId: context.lock.playerId,
    dedupeKey: scheduledEventDedupeKey(
      ScheduledEventKind.PLAYER_SETTLE_SWEEP,
      context.lock.playerId,
      nextDue.toString(),
    ),
  });
}

/**
 * Starts the chain for a player, called once by the registration path. The first sweep is
 * one period after the player starts, so a brand new account is not swept before it has
 * had time to accrue anything.
 */
export async function startSettleSweepChain(
  context: Pick<ScheduledEventContext, 'tx' | 'outbox' | 'reading' | 'lock'>,
): Promise<void> {
  const firstDue = toGameMsValue(context.reading.gameNow + SETTLE_SWEEP_PERIOD_GAME_MS);
  await scheduleEvent(context.tx, context.outbox, context.reading, {
    playerId: context.lock.playerId,
    kind: ScheduledEventKind.PLAYER_SETTLE_SWEEP,
    dueGameMs: firstDue,
    refType: 'PLAYER',
    refId: context.lock.playerId,
    dedupeKey: scheduledEventDedupeKey(
      ScheduledEventKind.PLAYER_SETTLE_SWEEP,
      context.lock.playerId,
      firstDue.toString(),
    ),
  });
}

// ---------------------------------------------------------------------------
// The periodic timer
// ---------------------------------------------------------------------------

/**
 * The reconciliation timer of the worker.
 *
 * It calls the sweep directly instead of enqueueing a `sim.reconcile` job, and that is the
 * point: the sweep is the recovery mechanism of the queue, so it must not depend on the
 * queue being usable in order to start. If Redis is down, every enqueue inside the sweep
 * fails and is logged, and the next pass tries again.
 */
export function startReconcileTimer(
  services: ServiceContext,
  intervalRealMs: number,
): { stop(): void } {
  const timer = setInterval(
    () => {
      void reconcile(services.schedulerDeps, 'periodic').catch((error: unknown) => {
        services.logger.warn({ err: error }, 'the periodic reconciliation sweep failed');
      });
    },
    Math.max(intervalRealMs, MIN_JOB_DELAY_REAL_MS),
  );
  timer.unref();
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}

/** The job name of the reconciliation sweep, for the development route. */
export const RECONCILE_JOB_NAME = JobName.SIM_RECONCILE;
