// Module `tasks`. The task engine: the validation of GDD sections 90 and 104, the
// scheduling, the completion and the cancellation.
//
// Owner: workflow W6-A. Replaces the scaffolding workflow W3-A left with the definitive
// path and signature (plan section 11, rule 3): `src/app.ts`, `src/handlers.ts` and the
// route registry were not touched, only the body of this module; `defineStubRoute` became
// `defineRoute`, in place.
//
// The shape of the module:
//
//   `record.ts`     the task row, its derived readings and the read model.
//   `assignment.ts` the six checks of GDD section 104 and the formula of GDD section 91,
//                   evaluated once for the preview and for the assignment.
//   `service.ts`    the three write paths and the core they share.
//   `routes.ts`     the HTTP surface, which converts and decides nothing.
//   `jobs.ts`       the handler of `TASK_COMPLETE`.
//
// What this module is responsible for, stated once so the boundary is not guessed:
//
//   - It owns the sequence. The order in which a worker, a set of machines, a target and a
//     store are checked and committed is a rule of GDD section 104 and it lives here.
//   - It owns the row that ties them together. `Task` plus `task_machines` is the single
//     authoritative link between a worker and a machine (ADR-0040); the reservation columns
//     on the other three tables are derived from it and are checked, never trusted.
//   - It owns nothing else. The crop cycle is `modules/fields`, the wear is
//     `modules/machinery`, the skill is `modules/workers`, the capacity of a store is
//     `modules/farms` and the price of anything is `modules/economy`. Every one of those is
//     a module of an earlier phase and is called rather than reimplemented.
//
// The one export a module outside this one needs is `cancelTasksForLiquidation`, which is
// the `CANCEL_TASKS` strategy the forced liquidation of `modules/economy` declares and
// leaves without an implementation (ADR-0039, `docs/handoff/NOTES-w5c.md` item 2.4). It is
// exported and not yet consumed, because naming it in the `STEP_PLAN` of that module is a
// change in a file this workflow does not own; the patch is in
// `docs/handoff/NOTES-w6a.md`, item 2.1.

import { type FastifyInstance } from 'fastify';
import { registerTasksRoutes as registerRoutes } from './routes.js';

/** Registra las rutas del area `tasks`. Invocada una vez por `src/app.ts`. */
export function registerTasksRoutes(app: FastifyInstance): void {
  registerRoutes(app);
}

export { OWNED_EVENT_KIND, taskCompleteHandler } from './jobs.js';

export {
  TASK_REF_TYPE,
  TASK_SELECT,
  findTask,
  loadRunningTasks,
  loadTaskPage,
  progressBp,
  requireTask,
  taskUpsertedFrame,
  toTaskDto,
  toTaskRecord,
  workedGameHours,
  type TaskPage,
  type TaskRecord,
  type TaskRow,
} from './record.js';

export {
  evaluateAssignment,
  firstBlocker,
  isFeasible,
  paceMachineType,
  roleOfMachine,
  type AssignmentEvaluation,
  type AssignmentRequest,
  type PlotRecord,
} from './assignment.js';

export {
  cancelTask,
  cancelTaskById,
  cancelTasksForLiquidation,
  completeTask,
  createTask,
  taskOfEvent,
  type CancelTaskOutcome,
  type CompleteTaskOutcome,
  type CreateTaskOutcome,
  type TaskClosure,
  type TaskContext,
} from './service.js';
