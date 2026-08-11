// The wiring of the two registries. The one place that knows every module.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Two registries need filling before either process is useful, and both are keyed by a closed
// set declared in `shared/` or in `lib/`:
//
//   - `SCHEDULED_EVENT_HANDLERS`, keyed by `ScheduledEventKind`: the domain effect of a due
//     event. It runs inside the transaction of `advancePlayer`, in both processes, because the
//     first request of a returning player must apply exactly what the worker would have.
//   - The job registry of the queue, keyed by the seven job names of plan section 6.4. Six of
//     them resolve to the same generic handler, which advances the player; the seventh is the
//     reconciliation sweep.
//
// This file exists so that neither `lib/queue.ts` nor `lib/advancePlayer.ts` has to import a
// module: the ESLint zones forbid it, and rightly, because a registry that imported its
// entries would be reopened by every workflow. Here the direction is the other way round, and
// this file is the only one that has to know the whole list (plan section 11, rule 3).
//
// Adding a module never changes this file either: the stub of every kind and of every job name
// already exists, with its final path and signature, so a later workflow replaces a body.

import { SCHEDULED_EVENT_HANDLERS, type ScheduledEventHandler } from './lib/advancePlayer.js';
import { type ServiceContext } from './lib/context.js';
import {
  createAdvanceJobHandler,
  createReconcileJobHandler,
  settleSweepHandler,
} from './lib/jobs.js';
import { JobName } from './lib/queue.js';
import { fieldAdvancePhaseHandler } from './modules/fields/jobs.js';
import { forestNotifyMilestoneHandler } from './modules/forestry/jobs.js';
import { machineRepairCompleteHandler } from './modules/machinery/jobs.js';
import { taskCompleteHandler } from './modules/tasks/jobs.js';
import { workerPoolRefreshHandler } from './modules/workers/jobs.js';
import { ScheduledEventKind } from './shared/index.js';

/**
 * The handler of every kind of due event, and the module that owns it.
 *
 * Exhaustive by construction: the record is keyed by the union, so a kind added to
 * `ScheduledEventKind` does not compile until it has an owner.
 */
const HANDLER_BY_KIND: Readonly<Record<ScheduledEventKind, ScheduledEventHandler>> = {
  // modules/tasks, workflow W6-A.
  [ScheduledEventKind.TASK_COMPLETE]: taskCompleteHandler,
  // modules/fields, workflow W4-C.
  [ScheduledEventKind.FIELD_ADVANCE_PHASE]: fieldAdvancePhaseHandler,
  // modules/machinery, workflow W5-A.
  [ScheduledEventKind.MACHINE_REPAIR_COMPLETE]: machineRepairCompleteHandler,
  // lib/jobs.ts: the settlement sweep is simulation infrastructure, not a domain module, and
  // the forced liquidation of plan section 6.6 extends it through `registerSettleSweepHook`.
  [ScheduledEventKind.PLAYER_SETTLE_SWEEP]: settleSweepHandler,
  // modules/workers, workflow W5-B.
  [ScheduledEventKind.WORKER_POOL_REFRESH]: workerPoolRefreshHandler,
  // modules/forestry, workflow W6-C.
  [ScheduledEventKind.FOREST_NOTIFY_MILESTONE]: forestNotifyMilestoneHandler,
};

/**
 * Fills both registries. Called by `server.ts` and by `worker.ts`, before either starts
 * serving, and idempotent: registering twice replaces an entry with itself.
 */
export function registerDomainHandlers(services: ServiceContext): void {
  for (const [kind, handler] of Object.entries(HANDLER_BY_KIND)) {
    SCHEDULED_EVENT_HANDLERS.register(kind as ScheduledEventKind, handler);
  }

  const advance = createAdvanceJobHandler(services);
  services.jobs.register(JobName.TASK_COMPLETE, advance);
  services.jobs.register(JobName.FIELD_ADVANCE_PHASE, advance);
  services.jobs.register(JobName.MACHINE_REPAIR_COMPLETE, advance);
  services.jobs.register(JobName.PLAYER_SETTLE_SWEEP, advance);
  services.jobs.register(JobName.WORKER_POOL_REFRESH, advance);
  services.jobs.register(JobName.FOREST_NOTIFY_MILESTONE, advance);
  services.jobs.register(JobName.SIM_RECONCILE, createReconcileJobHandler(services));
}
