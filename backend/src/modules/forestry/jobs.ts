// The scheduled events of the forestry module.
//
// Owner: workflow W6-C. Module `forestry`. Replaces the scaffolding workflow W3-A left with the
// definitive signature, so neither `src/handlers.ts`, nor the queue, nor the point of advance is
// reopened (plan section 11, rule 3).
//
// TWO HANDLERS AND ONE REGISTRATION, and the reason there are two is a boundary and not a
// design preference:
//
//   - `FOREST_NOTIFY_MILESTONE` is the kind `src/handlers.ts` already wires to this module. It
//     is per plot and never per tree, which is what makes notifying viable at all: GDD section
//     130 admits one tree per cell and a plot may hold two thousand, so an event per tree would
//     be tens of thousands of rows for a fact nothing depends on. The authority is the pure rule
//     of `shared/rules/forestry.ts`; this job only materialises and reports what that rule
//     already says (plan section 6.5, invariant 5).
//   - `TASK_COMPLETE` is wired to `modules/tasks` of workflow W6-A, which cannot import this
//     module and which this module cannot import (plan section 11, rule 4). The three forestry
//     operations nevertheless complete through that kind, because it is the kind the contract
//     and the queue declare for the completion of a task. The composition below is how the two
//     coexist: the forestry effect is tried first and, when the task is not one of ours, the
//     handler that was registered before is called unchanged.
//
// The composition is installed from `registerForestryRoutes`, which is the call site this module
// owns, exactly as `registerEconomyRoutes` installs `registerEconomySweepHooks` for the forced
// liquidation of ADR-0039. It is idempotent and it never replaces itself with a second wrapper.
//
// KNOWN GAP, with the same shape as the one ADR-0039 records for the settlement sweep: the
// worker process calls `registerDomainHandlers` and does not build the Fastify application, so
// the composition is not installed there. Until the one line recorded in
// `docs/handoff/NOTES-w6c.md` is applied to `src/worker.ts`, a forestry task whose completion is
// processed exclusively by the queue process falls through to the handler of `modules/tasks`.
// Correctness is not lost — the first request of the player applies it, which is the whole point
// of `advancePlayer` being the single point of advance — but punctuality is.

import { SCHEDULED_EVENT_HANDLERS, type ScheduledEventHandler } from '../../lib/advancePlayer.js';
import {
  NoticeKind,
  ScheduledEventKind,
  toWireGameMs,
  type ScheduledEventKind as ScheduledEventKindType,
} from '../../shared/index.js';
import { treesUpsertedFrame } from './readModel.js';
import { FOREST_PLOT_REF_TYPE, findLivePlot } from './record.js';
import { syncMilestoneSchedule, treesCrossingMilestone } from './service.js';
import { completeForestryTask, liveTreesOfArea } from './tasks.js';

/** El tipo de evento agendado que posee este modulo. */
export const OWNED_EVENT_KIND: ScheduledEventKindType = ScheduledEventKind.FOREST_NOTIFY_MILESTONE;

/**
 * Handler of `FOREST_NOTIFY_MILESTONE`: reports the trees of a plot that reached a stage worth
 * reporting (GDD section 131).
 *
 * Nothing is written to a tree here, and nothing has to be: the stage is derived from the
 * planting instant and the clock, so by the time this runs the trees have already matured
 * whether or not the job ran. What the job adds is the notification and the line of the return
 * summary of GDD section 68, plus the next alarm clock.
 *
 * A missing reference and a plot that no longer exists are both answered by doing nothing. An
 * event outliving its subject is expected at least once, and failing here would turn the due
 * instant into an endless BullMQ retry, because the point of advance has already marked the
 * event as processed.
 */
export const forestNotifyMilestoneHandler: ScheduledEventHandler = async (context) => {
  const { event, lock, reading, tx } = context;
  if (event.refType !== FOREST_PLOT_REF_TYPE || event.refId === null) {
    context.services.logger.warn(
      { kind: event.kind, scheduledEventId: event.id, playerId: lock.playerId },
      'forest milestone event without a plot reference',
    );
    return;
  }

  const plot = await findLivePlot(tx, lock.playerId, event.refId);
  if (plot === null) {
    context.services.logger.debug(
      { kind: event.kind, scheduledEventId: event.id, forestPlotId: event.refId },
      'forest milestone event of a plot that is no longer live',
    );
    return;
  }

  const standing = await liveTreesOfArea(tx, plot.id, null);
  const crossing = treesCrossingMilestone(standing, event.dueGameMs);
  // The next alarm clock is set on the way out, whether or not anything crossed: a window that
  // reported nothing is a window whose trees were felled, and the plot still has a future.
  await syncMilestoneSchedule(tx, context.outbox, reading, plot, event.dueGameMs, standing);
  if (crossing.length === 0) {
    return;
  }

  context.emit(treesUpsertedFrame(plot, standing, crossing, event.dueGameMs), {
    type: 'NOTICE',
    payload: {
      notice: {
        kind: NoticeKind.FOREST_MILESTONE,
        severity: 'INFO',
        code: null,
        message: `${crossing.length} arbol(es) de la parcela ${plot.name} alcanzaron la madurez.`,
        details: { forestPlotId: plot.id, treeCount: crossing.length },
        atGameMs: toWireGameMs(event.dueGameMs),
        subjectType: FOREST_PLOT_REF_TYPE,
        subjectId: plot.id,
      },
    },
  });
};

// ---------------------------------------------------------------------------
// The completion of a forestry task
// ---------------------------------------------------------------------------

/** The composed handler this module installed, so a second registration is a no-op. */
let installedTaskCompleteHandler: ScheduledEventHandler | null = null;

/**
 * The handler of `TASK_COMPLETE` this module contributes: the three forestry operations, and a
 * delegation to whatever was registered before for everything else.
 */
export function composeTaskCompleteHandler(
  delegate: ScheduledEventHandler | undefined,
): ScheduledEventHandler {
  return async (context) => {
    if (await completeForestryTask(context)) {
      return;
    }
    if (delegate !== undefined) {
      await delegate(context);
    }
  };
}

/**
 * Installs the forestry contribution to `TASK_COMPLETE`.
 *
 * Idempotent: registering twice leaves exactly one wrapper, because the handler currently
 * registered is compared against the one this module installed. The order matters and is
 * satisfied by construction: `registerDomainHandlers` runs before `buildApp` in `server.ts` and
 * in the integration harness, so the delegate captured here is the real handler of
 * `modules/tasks` and never the scaffolding.
 */
export function registerForestryScheduledHandlers(): void {
  const current = SCHEDULED_EVENT_HANDLERS.handlerFor(ScheduledEventKind.TASK_COMPLETE);
  if (installedTaskCompleteHandler !== null && current === installedTaskCompleteHandler) {
    return;
  }
  const composed = composeTaskCompleteHandler(current);
  installedTaskCompleteHandler = composed;
  SCHEDULED_EVENT_HANDLERS.register(ScheduledEventKind.TASK_COMPLETE, composed);
}

/** Forgets the installation. For the tests, which must not inherit the registration of another. */
export function resetForestryScheduledHandlerRegistration(): void {
  installedTaskCompleteHandler = null;
}
