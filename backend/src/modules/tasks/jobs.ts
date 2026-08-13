// The scheduled event this module owns: the completion of a task.
//
// Owner: workflow W6-A. Module `tasks`. Replaces the scaffolding workflow W3-A left with
// the definitive signature, so neither `src/handlers.ts`, nor the queue, nor the point of
// advance is reopened (plan section 11, rule 3). With this handler and the one of
// `modules/forestry`, `farm_world_scheduled_events_unhandled_total` is flat at zero.
//
// Contract of the handler, which does not change now that it is implemented:
//
//   - It runs inside the transaction of the advance and after the event was claimed with a
//     conditional update, so it must NOT check the status of the event again. What it does
//     check is the status of the TASK, which is a different row and a different race: the
//     player may have cancelled it in the millisecond before the alarm clock fired.
//   - Every effect belongs to that transaction. Enqueueing and publishing are recorded in
//     `context.outbox` and happen after the commit.
//   - Frames are declared with `context.emit(...)` and are written with the due instant of
//     the event, so a job that ran late places the change where it happened.
//   - No `Date.now()`: the instant is `context.reading` and the due one is
//     `context.event.dueGameMs`.
//
// WHY THE DUE INSTANT AND NOT THE CURRENT ONE, spelled out because it is the property the
// whole design of plan section 6.4 rests on. A task assigned at t and 84 game hours long
// completes at t + 84 h whether the worker was up or down: the completion is applied at
// t + 84 h, the accruals were settled up to t + 84 h before this ran, the wear is prorated
// over exactly those 84 hours and the weeds of the field grew for exactly that long. A
// player who reconnects a week later and a player who watched the whole thing therefore
// finish with byte identical rows, which is what makes BullMQ a requirement of punctuality
// and not of correctness.
//
// A missing reference, a task that no longer exists and a task that is already finished are
// all answered by doing nothing. None of the three is an error: an event outliving its
// subject is expected at least once, and throwing here would roll back the claim the point
// of advance already made and turn the vencimiento into an endless BullMQ retry (ADR-0016).

import { type ScheduledEventHandler } from '../../lib/advancePlayer.js';
import {
  ScheduledEventKind,
  type ScheduledEventKind as ScheduledEventKindType,
} from '../../shared/index.js';
import { TASK_REF_TYPE } from './record.js';
import { completeTask, taskOfEvent } from './service.js';

/** El tipo de evento agendado que posee este modulo. */
export const OWNED_EVENT_KIND: ScheduledEventKindType = ScheduledEventKind.TASK_COMPLETE;

/**
 * Handler of `TASK_COMPLETE`: closes the task, applies the transition of its target and
 * credits what it produced (GDD sections 105 and 111).
 */
export const taskCompleteHandler: ScheduledEventHandler = async (context) => {
  const { event, lock, tx } = context;
  if (event.refType !== TASK_REF_TYPE) {
    context.services.logger.warn(
      { kind: event.kind, scheduledEventId: event.id, playerId: lock.playerId },
      'task completion event without a task reference',
    );
    return;
  }

  const task = await taskOfEvent(tx, lock.playerId, event.refId);
  if (task === null) {
    context.services.logger.debug(
      { kind: event.kind, scheduledEventId: event.id, taskId: event.refId },
      'task completion event of a task that no longer exists',
    );
    return;
  }

  const outcome = await completeTask(context, task, event.dueGameMs);
  if (outcome === null) {
    // The task was cancelled between the assignment and the alarm clock. The conditional
    // transition of `completeTask` is what decided it, and a second delivery of this very
    // event lands here as well.
    context.services.logger.debug(
      { kind: event.kind, scheduledEventId: event.id, taskId: task.id, status: task.status },
      'task completion event of a task that was no longer in progress',
    );
    return;
  }

  context.services.logger.info(
    {
      taskId: outcome.task.id,
      operation: outcome.task.operation,
      playerId: lock.playerId,
      workedGameHours: outcome.workedGameHours,
      producedUnits: outcome.producedUnits,
      storedUnits: outcome.storedUnits,
      wastedUnits: outcome.wastedUnits,
      skillBefore: outcome.skillBefore,
      skillAfter: outcome.skillAfter,
    },
    'task completed',
  );
};
