// The outbox: scheduling a fact, waking up for it, and reconciling what was missed.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Invariant 4 of plan section 6.4. `scheduled_events` is the authoritative list of what
// must happen; Redis only holds alarm clocks for the subset inside the scheduling
// horizon. Four consequences are implemented here:
//
//   1. The row is inserted inside the domain transaction and the alarm clock is created
//      after the commit. The shape of `lib/outbox.ts` makes the wrong order impossible to
//      express, so this module records the intent and never enqueues.
//   2. The horizon. Only what falls due inside a real time window, 24 hours by default,
//      gets an alarm clock; the rest stays as a pending row. That is what bounds the
//      memory of Redis with tens of thousands of trees in the world, and what makes a
//      re-anchoring reschedule a few dozen jobs instead of the whole future.
//   3. A paused world parks instead of enqueueing. With `rateNum = 0` a due instant is
//      never reached, so `realMsFor` returns null and there is nothing to wait for;
//      enqueueing with a delay of zero would spin, because every handler would re-enqueue
//      on its due guard.
//   4. `sim.reconcile` enqueues, in order, everything already due, at start-up and
//      periodically. Losing the contents of Redis then loses nothing, which is what the
//      stack document assumes and what is only true because of this function.
//
// The identifier of a job is deterministic and carries the epoch (`lib/ids.ts`), so
// adding it twice is a no-op in BullMQ and the jobs of a superseded epoch are a different
// set that can be removed without touching the current one.

import { type PrismaClient } from '../generated/prisma/client.js';
import {
  ScheduledEventStatus,
  type GameMs,
  type PlayerId,
  type ScheduledEventKind,
} from '../shared/index.js';
import { type ClockReading, type GameClockService } from './gameClock.js';
import { scheduledJobId } from './ids.js';
import { type EnqueueEffect, type Outbox } from './outbox.js';
import { JOB_NAME_BY_EVENT_KIND, type DomainQueue } from './queue.js';
import { type Db, type Tx } from './tx.js';

/** What a domain path asks for when it schedules a fact. */
export interface ScheduleRequest {
  readonly playerId: PlayerId;
  readonly kind: ScheduledEventKind;
  readonly dueGameMs: GameMs;
  /** Polymorphic reference to the subject, with no foreign key (plan section 6.4). */
  readonly refType?: string | null;
  readonly refId?: string | null;
  /**
   * Deterministic key that makes scheduling the same fact twice a no-op while it is
   * pending. Unique among the pending rows only, so the same key may be scheduled again
   * once processed, as every pool refresh does.
   */
  readonly dedupeKey?: string | null;
}

/** The row that was written, or the one that already existed. */
export interface ScheduleResult {
  readonly scheduledEventId: string;
  /** True when a pending row with the same dedupe key already existed. */
  readonly deduped: boolean;
}

/**
 * Inserts the outbox row and records the alarm clock for after the commit.
 *
 * `epoch` comes from the clock reading of the caller and not from a second read: two rows
 * written by the same transaction must carry the same epoch, otherwise a retiming that
 * lands between the two reads would leave half of them stale.
 *
 * Deduplication is an insert that ignores the conflict, and not an insert with the violation
 * caught afterwards. The difference is not stylistic: in PostgreSQL a failed statement aborts
 * the whole transaction, so catching the violation leaves a transaction in which no further
 * command can run, and the "then read the row that already existed" half of that idea is
 * impossible. `ON CONFLICT ... DO NOTHING` on the partial index is the same pattern the plan
 * prescribes for the double purchase of a cell (section 5.4): insert what fits, and find out
 * what was really written.
 *
 * The predicate of the index has to be repeated in the conflict target, and repeated in full:
 * PostgreSQL infers a partial unique index only when the predicate given implies the one the index
 * carries, so `status = 'PENDING'` alone is refused with 42P10 and
 * `status = 'PENDING' AND "dedupeKey" IS NOT NULL` is accepted. It is written by hand for the same
 * reason the index is: the Prisma schema language cannot express either.
 */
export async function scheduleEvent(
  tx: Tx,
  outbox: Outbox,
  reading: ClockReading,
  request: ScheduleRequest,
): Promise<ScheduleResult> {
  const epoch = reading.world.scheduleEpoch;
  const refType = request.refType ?? null;
  const refId = request.refId ?? null;
  const dedupeKey = request.dedupeKey ?? null;

  const record = (scheduledEventId: string): void => {
    outbox.enqueue({
      scheduledEventId,
      playerId: request.playerId,
      eventKind: request.kind,
      dueGameMs: request.dueGameMs,
      epoch,
    });
  };

  if (dedupeKey === null) {
    // No key means the caller is describing a fact that may legitimately repeat, so there is
    // nothing to conflict with and the typed client is enough.
    const row = await tx.scheduledEvent.create({
      data: {
        playerId: request.playerId,
        kind: request.kind,
        dueGameMs: request.dueGameMs,
        epoch,
        refType,
        refId,
        dedupeKey: null,
        status: ScheduledEventStatus.PENDING,
      },
      select: { id: true },
    });
    record(row.id);
    return { scheduledEventId: row.id, deduped: false };
  }

  // `gen_random_uuid()` and not a value from the application: Prisma 7 generates the identifier
  // on the client for `@default(uuid(7))` and emits no database default, so a raw insert has to
  // supply one (backend/prisma/README.md, section 2).
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "scheduled_events" (
      "id", "playerId", "kind", "refType", "refId", "dueGameMs", "status", "epoch", "dedupeKey"
    ) VALUES (
      gen_random_uuid(),
      ${request.playerId}::uuid,
      ${request.kind}::"ScheduledEventKind",
      ${refType},
      ${refId},
      ${request.dueGameMs},
      'PENDING'::"ScheduledEventStatus",
      ${epoch},
      ${dedupeKey}
    )
    ON CONFLICT ("playerId", "dedupeKey")
      WHERE "status" = 'PENDING' AND "dedupeKey" IS NOT NULL
      DO NOTHING
    RETURNING "id"
  `;

  const insertedId = inserted[0]?.id;
  if (insertedId !== undefined) {
    record(insertedId);
    return { scheduledEventId: insertedId, deduped: false };
  }

  // Nothing was inserted, so a pending row with this key already exists: the fact is already
  // scheduled and its alarm clock was recorded when it was written. Recording it again would be
  // harmless, because the job identifier is deterministic and BullMQ ignores a duplicate, but it
  // would also be a lie about what this call did.
  const existing = await tx.scheduledEvent.findFirst({
    where: {
      playerId: request.playerId,
      dedupeKey,
      status: ScheduledEventStatus.PENDING,
    },
    select: { id: true },
  });
  if (existing === null) {
    // The row was processed or cancelled between the insert and this read, which makes the key
    // free again. Reporting it is better than looping: the caller is inside a transaction and can
    // decide, and the periodic sweep will schedule the fact again if it is still due.
    throw new Error(
      `The dedupe key ${dedupeKey} conflicted and no pending row was found. Retry the operation.`,
    );
  }
  return { scheduledEventId: existing.id, deduped: true };
}

/**
 * Cancels a pending row and records the removal of its alarm clock.
 *
 * The status change is conditional on the row still being pending, so cancelling an event
 * that has just been processed is a no-op instead of a rewrite of history. The job is
 * removed after the commit like any other side effect; a job that survives the removal is
 * harmless, because its handler re-reads the row and finds it cancelled.
 */
export async function cancelScheduledEvent(
  tx: Tx,
  outbox: Outbox,
  scheduledEventId: string,
): Promise<boolean> {
  const row = await tx.scheduledEvent.findUnique({
    where: { id: scheduledEventId },
    select: { jobId: true, status: true },
  });
  if (row === null || row.status !== ScheduledEventStatus.PENDING) {
    return false;
  }
  const updated = await tx.scheduledEvent.updateMany({
    where: { id: scheduledEventId, status: ScheduledEventStatus.PENDING },
    data: { status: ScheduledEventStatus.CANCELED },
  });
  if (updated.count === 0) {
    return false;
  }
  if (row.jobId !== null) {
    outbox.removeJob(row.jobId);
  }
  return true;
}

/** Cancels every pending row that points at a subject, which is what a sale does. */
export async function cancelScheduledEventsFor(
  tx: Tx,
  outbox: Outbox,
  playerId: PlayerId,
  refType: string,
  refId: string,
): Promise<number> {
  const rows = await tx.scheduledEvent.findMany({
    where: { playerId, refType, refId, status: ScheduledEventStatus.PENDING },
    select: { id: true },
  });
  let cancelled = 0;
  for (const row of rows) {
    if (await cancelScheduledEvent(tx, outbox, row.id)) {
      cancelled += 1;
    }
  }
  return cancelled;
}

// ---------------------------------------------------------------------------
// The alarm clocks
// ---------------------------------------------------------------------------

/** What the enqueueing side needs. Assembled by the service context. */
export interface SchedulerDeps {
  readonly prisma: PrismaClient;
  readonly queue: DomainQueue;
  readonly clock: GameClockService;
  readonly horizonRealMs: number;
  readonly logger: {
    warn(object: Record<string, unknown>, message: string): void;
    info(object: Record<string, unknown>, message: string): void;
    debug(object: Record<string, unknown>, message: string): void;
  };
}

/** Why an event did not get an alarm clock. Reported, never silent. */
export const ParkReason = {
  WORLD_PAUSED: 'WORLD_PAUSED',
  BEYOND_HORIZON: 'BEYOND_HORIZON',
} as const;
export type ParkReason = (typeof ParkReason)[keyof typeof ParkReason];

/** The delay of an alarm clock, or the reason there is none. */
export function delayFor(
  reading: ClockReading,
  dueGameMs: GameMs,
  horizonRealMs: number,
): { readonly delayRealMs: number } | { readonly park: ParkReason } {
  if (reading.paused) {
    return { park: ParkReason.WORLD_PAUSED };
  }
  const dueRealMs = reading.world.rateNum === 0 ? null : realInstant(reading, dueGameMs);
  if (dueRealMs === null) {
    return { park: ParkReason.WORLD_PAUSED };
  }
  const delta = dueRealMs - reading.atRealMs;
  if (delta > BigInt(horizonRealMs)) {
    return { park: ParkReason.BEYOND_HORIZON };
  }
  return { delayRealMs: delta <= 0n ? 0 : Number(delta) };
}

/** `realMsFor` of the reading, kept separate so `delayFor` stays readable. */
function realInstant(reading: ClockReading, dueGameMs: GameMs): bigint | null {
  const world = reading.world;
  if (world.rateNum === 0) {
    return null;
  }
  const delta = dueGameMs - world.anchorGameMs;
  const rateDen = BigInt(world.rateDen);
  const rateNum = BigInt(world.rateNum);
  // Ceiling division, which is what guarantees the absence of early firing
  // (shared/rules/clock.ts states the same rule; it is repeated here on `bigint` so that
  // a reading does not have to be turned back into an anchor object).
  const quotient = (delta * rateDen) / rateNum;
  const remainder = (delta * rateDen) % rateNum;
  const rounded = remainder > 0n ? quotient + 1n : quotient;
  const value = world.anchorRealMs + rounded;
  return value < 0n ? 0n : value;
}

/**
 * Creates the alarm clock of one recorded effect and marks the row as enqueued.
 *
 * A failure here is logged and swallowed: the row is committed and the reconciliation
 * sweep will pick it up, so turning a Redis hiccup into a failed request would trade a
 * few seconds of punctuality for a visible error.
 */
export async function enqueueEffect(deps: SchedulerDeps, effect: EnqueueEffect): Promise<boolean> {
  const reading = await deps.clock.read();
  const outcome = delayFor(reading, effect.dueGameMs, deps.horizonRealMs);
  if ('park' in outcome) {
    deps.logger.debug(
      {
        scheduledEventId: effect.scheduledEventId,
        kind: effect.eventKind,
        dueGameMs: effect.dueGameMs.toString(),
        reason: outcome.park,
      },
      'scheduled event parked without an alarm clock',
    );
    return false;
  }

  const jobId = scheduledJobId(effect.scheduledEventId, effect.epoch);
  const jobName = JOB_NAME_BY_EVENT_KIND[effect.eventKind as ScheduledEventKind];
  if (jobName === undefined) {
    deps.logger.warn(
      { kind: effect.eventKind, scheduledEventId: effect.scheduledEventId },
      'no job name for the kind of scheduled event',
    );
    return false;
  }

  try {
    await deps.queue.add(
      jobName,
      jobId,
      {
        scheduledEventId: effect.scheduledEventId,
        playerId: effect.playerId,
        kind: effect.eventKind as ScheduledEventKind,
        dueGameMs: effect.dueGameMs.toString(),
        epoch: effect.epoch,
      },
      outcome.delayRealMs,
    );
    await deps.prisma.scheduledEvent.updateMany({
      where: { id: effect.scheduledEventId, status: ScheduledEventStatus.PENDING },
      data: { enqueuedAtRealMs: reading.atRealMs, jobId },
    });
    return true;
  } catch (error) {
    deps.logger.warn(
      { err: error, scheduledEventId: effect.scheduledEventId, jobId },
      'could not create the alarm clock; the reconciliation sweep will pick it up',
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** Rows one sweep enqueues at most, so a long outage is drained in bounded batches. */
export const RECONCILE_BATCH = 500;

export interface ReconcileResult {
  readonly enqueuedEvents: number;
  readonly pendingEvents: number;
  readonly parked: number;
}

/**
 * Enqueues, in order, everything already due, plus what has entered the horizon and has
 * no alarm clock yet.
 *
 * Ordered by due instant and not by insertion, because the order events are applied in is
 * the order they fell due: `advancePlayer` settles accruals up to each event before
 * applying it, so a later event applied first would settle a window that the earlier one
 * still has to charge into.
 *
 * Runs at start-up and periodically. It is also the whole answer to "what happens if
 * Redis is flushed": nothing, because the authoritative list never lived there.
 */
export async function reconcile(
  deps: SchedulerDeps,
  reason: 'startup' | 'periodic' | 'manual',
): Promise<ReconcileResult> {
  const reading = await deps.clock.read();
  const pendingEvents = await deps.prisma.scheduledEvent.count({
    where: { status: ScheduledEventStatus.PENDING },
  });

  const due = await deps.prisma.scheduledEvent.findMany({
    where: { status: ScheduledEventStatus.PENDING, dueGameMs: { lte: reading.gameNow } },
    orderBy: [{ dueGameMs: 'asc' }, { id: 'asc' }],
    take: RECONCILE_BATCH,
    select: { id: true, playerId: true, kind: true, dueGameMs: true, epoch: true },
  });

  const soon = await deps.prisma.scheduledEvent.findMany({
    where: {
      status: ScheduledEventStatus.PENDING,
      dueGameMs: { gt: reading.gameNow },
      enqueuedAtRealMs: null,
    },
    orderBy: [{ dueGameMs: 'asc' }, { id: 'asc' }],
    take: RECONCILE_BATCH,
    select: { id: true, playerId: true, kind: true, dueGameMs: true, epoch: true },
  });

  let enqueued = 0;
  let parked = 0;
  for (const row of [...due, ...soon]) {
    const created = await enqueueEffect(deps, {
      kind: 'enqueue',
      scheduledEventId: row.id,
      playerId: row.playerId as PlayerId,
      eventKind: row.kind,
      dueGameMs: row.dueGameMs as unknown as GameMs,
      // The current epoch and not the stored one: an alarm clock created now must be
      // discardable by the next retiming, and a job carrying a superseded epoch would be
      // removed by the very retiming that scheduled it.
      epoch: reading.world.scheduleEpoch,
    });
    if (created) {
      enqueued += 1;
    } else {
      parked += 1;
    }
  }

  deps.logger.info(
    { reason, enqueued, parked, pendingEvents, dueRows: due.length, horizonRows: soon.length },
    'reconciliation sweep',
  );
  return { enqueuedEvents: enqueued, pendingEvents, parked };
}

/**
 * Reschedules the jobs of the horizon after a retiming: every pending row inside the
 * horizon gets a new alarm clock under the new epoch, and the old jobs are removed by
 * identifier, which is why the epoch is part of it.
 */
export async function rescheduleHorizon(deps: SchedulerDeps): Promise<number> {
  const reading = await deps.clock.read();
  const rows = await deps.prisma.scheduledEvent.findMany({
    where: { status: ScheduledEventStatus.PENDING },
    orderBy: [{ dueGameMs: 'asc' }, { id: 'asc' }],
    take: RECONCILE_BATCH,
    select: { id: true, playerId: true, kind: true, dueGameMs: true, epoch: true, jobId: true },
  });

  let rescheduled = 0;
  for (const row of rows) {
    if (row.jobId !== null) {
      await deps.queue.remove(row.jobId);
    }
    const created = await enqueueEffect(deps, {
      kind: 'enqueue',
      scheduledEventId: row.id,
      playerId: row.playerId as PlayerId,
      eventKind: row.kind,
      dueGameMs: row.dueGameMs as unknown as GameMs,
      epoch: reading.world.scheduleEpoch,
    });
    if (created) {
      rescheduled += 1;
    }
  }
  return rescheduled;
}

/** The rows of a player that are pending and already due, in the order they must run. */
export async function dueEventsOf(
  db: Db,
  playerId: PlayerId,
  toGameMs: GameMs,
  limit: number,
): Promise<
  readonly {
    readonly id: string;
    readonly kind: ScheduledEventKind;
    readonly dueGameMs: bigint;
    readonly epoch: number;
    readonly refType: string | null;
    readonly refId: string | null;
  }[]
> {
  return db.scheduledEvent.findMany({
    where: {
      playerId,
      status: ScheduledEventStatus.PENDING,
      dueGameMs: { lte: toGameMs },
    },
    orderBy: [{ dueGameMs: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, kind: true, dueGameMs: true, epoch: true, refType: true, refId: true },
  });
}
