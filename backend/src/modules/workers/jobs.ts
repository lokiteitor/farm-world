// The scheduled event this module owns: the periodic refresh of the hiring pool.
//
// Owner: workflow W5-B. Module `workers`. Replaces the scaffolding workflow W3-A left with
// the definitive signature, so neither `src/handlers.ts`, nor the queue, nor the point of
// advance is reopened (plan section 11, rule 3). With this file in place,
// `farm_world_scheduled_events_unhandled_total` no longer counts `WORKER_POOL_REFRESH`.
//
// GDD section 102 names `poolRefreshInterval` and gives neither value nor unit; the plan
// fixes it at 48 game hours for coherence with the rest of the domain, and the constant lives
// in `shared/config/workers.ts`. The event is therefore repeatable: every run lists a new
// pool and schedules the next one, and there is never more than one pending, because the
// dedupe key of `lib/ids.ts` is unique among the pending rows of a player.
//
// Contract of the handler, which does not change now that it is implemented:
//
//   - It runs inside the transaction of the advance and after the event was claimed with a
//     conditional update, so it must NOT check the status again.
//   - Every effect belongs to that transaction. Enqueueing and publishing are recorded in
//     `context.outbox` and happen after the commit.
//   - Frames are declared with `context.emit(...)` and are written with the due instant of
//     the event, so a job that ran late places the change where it happened.
//   - No `Date.now()`: the instant is `context.reading` and the due one is
//     `context.event.dueGameMs`.
//
// The pool refresh moves no money and changes no rate, which is why it is the one scheduled
// event of the project that may skip whole intervals: `poolCatchUp` lists the pool of the
// boundary the player is actually standing in rather than replaying every boundary he slept
// through. Nothing observable is lost, because a pool that was never read can never have been
// hired from, and the ledger has no term that depends on it. The reasoning, and the reason
// the crop cycle does the opposite, are in `service.ts`.

import { type ScheduledEventHandler } from '../../lib/advancePlayer.js';
import {
  ScheduledEventKind,
  type ScheduledEventKind as ScheduledEventKindType,
} from '../../shared/index.js';
import {
  POOL_REF_TYPE,
  buildPoolReply,
  poolCatchUp,
  poolUpsertedFrame,
  replacePool,
} from './service.js';

/** El tipo de evento agendado que posee este modulo. */
export const OWNED_EVENT_KIND: ScheduledEventKindType = ScheduledEventKind.WORKER_POOL_REFRESH;

/**
 * Handler of `WORKER_POOL_REFRESH`: replaces the hiring pool of a player and schedules the
 * next refresh (GDD section 102).
 *
 * An event whose reference is missing or points at another player is answered by doing
 * nothing beyond re-scheduling, and that is not defensive coding: the point of advance has
 * already marked the row as processed, so throwing here would turn the due instant into an
 * endless BullMQ retry that could never make progress.
 */
export const workerPoolRefreshHandler: ScheduledEventHandler = async (context) => {
  const { event, lock, reading, tx, outbox } = context;

  if (event.refType !== POOL_REF_TYPE || event.refId !== lock.playerId) {
    context.services.logger.warn(
      {
        kind: event.kind,
        scheduledEventId: event.id,
        playerId: lock.playerId,
        refType: event.refType,
        refId: event.refId,
      },
      'pool refresh event without the reference of its own player',
    );
  }

  const boundaries = poolCatchUp(event.dueGameMs, reading.gameNow);
  await replacePool(
    tx,
    outbox,
    reading,
    lock.playerId,
    boundaries.listedAtGameMs,
    boundaries.nextRefreshAtGameMs,
  );

  // The reply is rebuilt from the rows rather than from the write, so what the client
  // receives is what a `GET /api/workers/pool` would answer a millisecond later.
  context.emit(poolUpsertedFrame(await buildPoolReply(tx, lock.playerId)));
};
