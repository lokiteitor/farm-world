// Seams between domain modules that the zone rules deliberately keep apart.
//
// Owner: workflow W7-A (integration). Written to close the two cross-module dependencies
// that no phase could write, without weakening the rule that produced them.
//
// Rule 4 of plan section 11 forbids imports between sibling backend modules of the same
// phase, and `eslint.config.js` implements it as "a module may import itself and every
// module of a strictly earlier phase". Two real dependencies cross that line, and they
// cross it in opposite directions:
//
//   - `modules/economy` (phase W5) needs `cancelTasksForLiquidation` of `modules/tasks`
//     (phase W6) for the `CANCEL_TASKS` step of the forced liquidation of plan section 6.6.
//     A later phase, so no relaxation of the rule would ever allow it.
//   - `modules/tasks` needs `modules/forestry` to undo the marks a cancelled felling left,
//     and the two are siblings of the same phase, which is exactly the case the rule exists
//     for (docs/handoff/NOTES-w6c.md 2.2).
//
// `NOTES-w6c.md` 2.2 offers two ways out and asks the integrator to choose: relax the zone,
// or declare a registry in `lib/`. This file is the second, and it is chosen because
// relaxing the zone would legitimise a dependency between siblings of the same phase for
// the whole module and for good, whereas the registry keeps the direction of every import
// pointing at `lib/`, which is the direction `SCHEDULED_EVENT_HANDLERS` and
// `registerSettleSweepHook` already follow.
//
// The filling point is `src/handlers.ts`, the one file that knows every module, and it is
// invoked by `server.ts` and by `worker.ts` alike. That matters beyond tidiness: the two
// hooks that were registered from a route registration were installed only in the process
// that builds the Fastify application, so the queue process ran without them
// (docs/handoff/NOTES-w5c.md 2.1, NOTES-w6c.md 2.1).
//
// The shapes below are structural and name no type of any module: `lib/` may not import a
// module either. Each one is the narrowest description of what the consumer needs.

import { type GameMs, type TaskOperation } from '../shared/index.js';
import { type ScheduledEventContext } from './advancePlayer.js';
import { type DomainEventDraft } from './events.js';
import { type Outbox } from './outbox.js';
import { type Tx } from './tx.js';

// ---------------------------------------------------------------------------
// The `CANCEL_TASKS` step of the forced liquidation
// ---------------------------------------------------------------------------

/** One task a liquidation cancelled, as the ledger entry of the step reports it. */
export interface CancelledForLiquidation {
  readonly taskId: string;
  readonly operation: TaskOperation;
}

/**
 * Cancels every running task of the locked player, with the prorated wear, the release of
 * the storage reservation and the retirement of the queued work (GDD sections 106 and 111).
 *
 * It frees no money by itself. What it does is stop the operating cost of GDD section 94 and
 * hand the machinery back to `IDLE`, which is what gives the steps around it something to
 * sell on the next sweep (docs/handoff/NOTES-w6a.md 2.1).
 */
export type LiquidationTaskCanceller = (
  context: ScheduledEventContext,
  atGameMs: GameMs,
) => Promise<readonly CancelledForLiquidation[]>;

let liquidationTaskCanceller: LiquidationTaskCanceller | null = null;

/** Registers the strategy of the `CANCEL_TASKS` step. The last registration wins. */
export function registerLiquidationTaskCanceller(canceller: LiquidationTaskCanceller): void {
  liquidationTaskCanceller = canceller;
}

/** The registered strategy, or null. Null means the step reports itself as not run. */
export function taskCancellerForLiquidation(): LiquidationTaskCanceller | null {
  return liquidationTaskCanceller;
}

// ---------------------------------------------------------------------------
// Module state a cancelled task leaves behind
// ---------------------------------------------------------------------------

/**
 * The fields of a cancelled task a release strategy may read.
 *
 * Structural on purpose: `TaskRecord` of `modules/tasks` satisfies it, and declaring the
 * intersection is what lets the strategy live in another module without either of the two
 * importing the other.
 */
export interface CancelledTaskView {
  readonly id: string;
  readonly playerId: string;
  readonly operation: TaskOperation;
  readonly targetForestPlotId: string | null;
  readonly destinationFarmId: string | null;
  readonly reservedStorageUnits: number | null;
}

/**
 * Undoes what a cancelled task reserved inside a module the canceller cannot import, and
 * returns the frames that state produces.
 *
 * Narrow by design. Everything a cancellation does that is not module specific —closing the
 * task, releasing the target, the prorated wear, the storage reservation, the worker, the
 * scheduled work— is already done by `cancelTask` of `modules/tasks` for every operation, so
 * a strategy that repeated any of it would release the same reservation twice.
 */
export type CancelledTaskRelease = (
  tx: Tx,
  outbox: Outbox,
  task: CancelledTaskView,
  atGameMs: GameMs,
) => Promise<readonly DomainEventDraft[]>;

const cancelledTaskReleases: CancelledTaskRelease[] = [];

/** Registers a release strategy. Order of registration is order of execution. */
export function registerCancelledTaskRelease(release: CancelledTaskRelease): void {
  cancelledTaskReleases.push(release);
}

/** Runs every registered strategy and collects the frames they produced. */
export async function releaseCancelledTask(
  tx: Tx,
  outbox: Outbox,
  task: CancelledTaskView,
  atGameMs: GameMs,
): Promise<readonly DomainEventDraft[]> {
  const frames: DomainEventDraft[] = [];
  for (const release of cancelledTaskReleases) {
    frames.push(...(await release(tx, outbox, task, atGameMs)));
  }
  return frames;
}

/** Clears both registries. For the tests, which must not inherit the registrations of another. */
export function resetModuleSeams(): void {
  liquidationTaskCanceller = null;
  cancelledTaskReleases.length = 0;
}
