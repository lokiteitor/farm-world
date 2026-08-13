// The scheduled event this module owns: the completion of a workshop repair.
//
// Owner: workflow W5-A. Module `machinery`. It replaces the scaffolding workflow W3-A left
// with the definitive signature, so neither `src/handlers.ts`, nor the queue, nor the point
// of advance is reopened (plan section 11, rule 3). The metric
// `farm_world_scheduled_events_unhandled_total` no longer counts this kind.
//
// GDD section 93 gives repair no duration at all and GDD section 95 leaves `IN_REPAIR`
// reserved. Plan section 2.2 resolves both at once: the repair is a scheduled event whose
// length is proportional to the points restored, so the state becomes real and the decision
// to repair acquires an opportunity cost in the middle of a cycle. It consumes no worker.
//
// Contract of the handler, which does not change now that it is implemented:
//
//   - It runs inside the transaction of the advance and after the event was claimed with a
//     conditional update, so it must NOT check the status of the event again.
//   - Every effect belongs to that transaction. Enqueueing and publishing are recorded in
//     `context.outbox` and happen after the commit.
//   - Frames are declared with `context.emit(...)` and are written with the due instant of
//     the event, so a job that ran late places the change where it happened.
//   - No `Date.now()`: the instant is `context.reading` and the due one is
//     `context.event.dueGameMs`.
//
// The handler carries nothing forward from the request that scheduled it, because the
// payload of a scheduled event is identifiers and nothing else (plan section 6.4). It does
// not need to: the number of points the player paid for is the length of the repair, so
// `scheduledRestorationBp` reads it back from the two instants already on the row. That is
// the same discipline `modules/fields` follows, where the projection is the authority and the
// job only materialises what it says.

import { type ScheduledEventHandler } from '../../lib/advancePlayer.js';
import {
  MachineStatus,
  ScheduledEventKind,
  type ScheduledEventKind as ScheduledEventKindType,
} from '../../shared/index.js';
import { machineUpsertedFrame } from './readModel.js';
import { MACHINE_REF_TYPE, findLiveMachine } from './record.js';
import { completeRepair } from './service.js';

/** El tipo de evento agendado que posee este modulo. */
export const OWNED_EVENT_KIND: ScheduledEventKindType = ScheduledEventKind.MACHINE_REPAIR_COMPLETE;

/**
 * Handler of `MACHINE_REPAIR_COMPLETE`: restores the condition and returns the machine to
 * `IDLE` (GDD section 93).
 *
 * A missing reference, a machine that no longer exists, a machine of another player and a
 * machine that is no longer in the workshop are all answered by doing nothing. None of the
 * four is an error: a sale cancels the pending row but races with an alarm clock that is
 * already in flight, and failing here would turn the due instant into an endless BullMQ
 * retry, because the point of advance has already marked the event as processed.
 */
export const machineRepairCompleteHandler: ScheduledEventHandler = async (context) => {
  const { event, lock, tx } = context;
  if (event.refType !== MACHINE_REF_TYPE || event.refId === null) {
    context.services.logger.warn(
      { kind: event.kind, scheduledEventId: event.id, playerId: lock.playerId },
      'repair event without a machine reference',
    );
    return;
  }

  const machine = await findLiveMachine(tx, lock.playerId, event.refId);
  if (machine === null || machine.status !== MachineStatus.IN_REPAIR) {
    context.services.logger.debug(
      { kind: event.kind, scheduledEventId: event.id, machineId: event.refId },
      'repair event of a machine that is no longer being repaired',
    );
    return;
  }

  // The due instant and not the current one: the repair finished when its end was reached,
  // and `advancePlayer` writes the frame with that instant.
  const repaired = await completeRepair(tx, machine, event.dueGameMs);
  context.emit(machineUpsertedFrame(repaired));
};
