// The scheduled event this module owns: the automatic phase transitions of the crop cycle.
//
// Owner: workflow W4-C. Module `fields`. Replaces the scaffolding workflow W3-A left with
// the definitive signature, so neither `src/handlers.ts`, nor the queue, nor the point of
// advance is reopened (plan section 11, rule 3).
//
// `SEEDED -> GERMINATING -> GROWING -> READY_TO_HARVEST` are the three transitions GDD
// section 76 marks as automatic, and they are hybrid in the sense of plan section 6.5: the
// pure projection is the authority and this job only materialises the result and notifies
// it, recomputing it with the very same function. Nothing here decides anything the
// projection has not already decided, which is what makes the two paths agree:
//
//   - The job path. The alarm clock fires, `advancePlayer` claims the row and calls this,
//     which calls `materializeProjectedPhase` and emits `FIELD_UPSERTED`.
//   - The projection path. The player asks for a harvest before the job ran, the write path
//     calls `materializeProjectedPhase` inside its own transaction, and the field is already
//     `READY_TO_HARVEST` when the operation is validated.
//
// Both end on the same row, because both apply the same transitions at the same boundary
// instants, and applying them twice does nothing the second time: the loop compares the
// stored state with the projected one and stops when they agree.
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
// One transition per event, and the next alarm clock is scheduled on the way out. A player
// who returns after two hundred hours therefore crosses the three boundaries in three
// passes of the queue, each one leaving the stored history exactly where a punctual run
// would have left it. Catching every boundary up inside one handler would apply effects
// past the instant the accruals were settled to, which is the error the ordering of
// `advancePlayer` exists to avoid.

import { type ScheduledEventHandler } from '../../lib/advancePlayer.js';
import {
  ScheduledEventKind,
  type ScheduledEventKind as ScheduledEventKindType,
} from '../../shared/index.js';
import {
  FIELD_REF_TYPE,
  fieldUpsertedFrame,
  findLiveField,
  materializeProjectedPhase,
  syncPhaseSchedule,
} from './service.js';

/** El tipo de evento agendado que posee este modulo. */
export const OWNED_EVENT_KIND: ScheduledEventKindType = ScheduledEventKind.FIELD_ADVANCE_PHASE;

/**
 * Handler of `FIELD_ADVANCE_PHASE`: materialises the phase transition of a field and
 * notifies it (GDD sections 76 and 80).
 *
 * A missing reference, a field that no longer exists and a field of another player are all
 * answered by doing nothing. None of the three is an error: an event outliving its subject
 * is expected at least once, because a merge disposes of a field and a cancellation races
 * with a due alarm clock, and failing here would turn the vencimiento into an endless BullMQ
 * retry, since the point of advance has already marked the event as processed.
 */
export const fieldAdvancePhaseHandler: ScheduledEventHandler = async (context) => {
  const { event, lock, reading, tx } = context;
  if (event.refType !== FIELD_REF_TYPE || event.refId === null) {
    context.services.logger.warn(
      { kind: event.kind, scheduledEventId: event.id, playerId: lock.playerId },
      'field phase event without a field reference',
    );
    return;
  }

  const field = await findLiveField(tx, lock.playerId, event.refId);
  if (field === null) {
    context.services.logger.debug(
      { kind: event.kind, scheduledEventId: event.id, fieldId: event.refId },
      'field phase event of a field that is no longer live',
    );
    return;
  }

  // The due instant and not the current one: the transition happened when the boundary was
  // crossed, and the frame is written with that instant by `advancePlayer`.
  const advanced = await materializeProjectedPhase(tx, field, event.dueGameMs);
  if (advanced.cropCycleState === field.cropCycleState) {
    // The alarm clock fired for a boundary the write path had already materialised. Nothing
    // to apply and nothing to say; the schedule is still synchronised below.
    await syncPhaseSchedule(tx, context.outbox, reading, advanced);
    return;
  }

  await syncPhaseSchedule(tx, context.outbox, reading, advanced);
  // The geometry did not change, so the frame carries no cells (`shared/ws/events.ts`).
  context.emit(fieldUpsertedFrame(advanced, event.dueGameMs, null));
};
