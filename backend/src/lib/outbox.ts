// The transactional outbox: what happens after the commit, collected during it.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Invariant 4 of plan section 6.4: `ScheduledEvent` in PostgreSQL is the
// authoritative list of what must happen and Redis only holds alarm clocks. The row
// is inserted inside the domain transaction and the alarm clock is created after the
// commit, never inside it. The same applies to publishing an event to the live
// channel and to removing the queue job of a cancelled event.
//
// Getting that right by discipline does not survive six more workflows, so it is
// enforced by shape instead: the transaction body receives an `Outbox`, which only
// records intent, and `withTransaction` flushes it once the commit has returned.
// There is no way to reach the queue or the pub/sub from inside a transaction,
// because the code that can do it is not passed in.
//
// Why it matters concretely. Enqueueing inside the transaction produces a job that
// runs against a row that is not committed yet, and the handler then finds nothing and
// either fails or, worse, treats the absence as "already processed". Publishing inside
// the transaction produces a frame the client applies before the state exists, which
// makes the client the authority for a few milliseconds, and the client is never the
// authority (plan section 7).

import { type GameMs, type PlayerId, type WsServerFrame } from '../shared/index.js';

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** An alarm clock to create for a row of the outbox that is inside the horizon. */
export interface EnqueueEffect {
  readonly kind: 'enqueue';
  readonly scheduledEventId: string;
  readonly playerId: PlayerId;
  readonly eventKind: string;
  readonly dueGameMs: GameMs;
  readonly epoch: number;
}

/** A job to remove, because the event it belonged to was cancelled or re-anchored. */
export interface RemoveJobEffect {
  readonly kind: 'removeJob';
  readonly jobId: string;
}

/**
 * Frames to publish to the live channel of a player. They are already persisted as
 * `GameEvent` rows inside the transaction, with their sequence assigned, so a frame
 * that never reaches the socket is recoverable by replay and never lost.
 */
export interface PublishEffect {
  readonly kind: 'publish';
  readonly playerId: PlayerId;
  readonly frames: readonly WsServerFrame[];
}

export type OutboxEffect = EnqueueEffect | RemoveJobEffect | PublishEffect;

// ---------------------------------------------------------------------------
// The collector
// ---------------------------------------------------------------------------

/** What the body of a transaction may record. Recording never performs anything. */
export interface Outbox {
  enqueue(effect: Omit<EnqueueEffect, 'kind'>): void;
  removeJob(jobId: string): void;
  publish(playerId: PlayerId, frames: readonly WsServerFrame[]): void;
}

/** The collector, with the accumulated effects exposed for the flush. */
export interface OutboxCollector extends Outbox {
  readonly effects: readonly OutboxEffect[];
  /** True when nothing was recorded, which is the common case of a read path. */
  readonly isEmpty: boolean;
}

export function createOutbox(): OutboxCollector {
  const effects: OutboxEffect[] = [];
  return {
    enqueue(effect) {
      effects.push({ kind: 'enqueue', ...effect });
    },
    removeJob(jobId) {
      effects.push({ kind: 'removeJob', jobId });
    },
    publish(playerId, frames) {
      if (frames.length > 0) {
        effects.push({ kind: 'publish', playerId, frames });
      }
    },
    get effects() {
      return effects;
    },
    get isEmpty() {
      return effects.length === 0;
    },
  };
}

/** Signature of the flush. Provided by the service context, never by the caller. */
export type OutboxFlush = (collector: OutboxCollector) => Promise<void>;

/**
 * A flush that does nothing, for a caller with no queue and no Redis: the balance
 * self audit of a test, and the seed. It is explicit so that "no side effects wanted"
 * cannot be confused with "the flush was forgotten".
 */
export const discardOutbox: OutboxFlush = async () => {
  await Promise.resolve();
};
