// The scheduled work of the `economy` module: the forced liquidation branch of the sweep.
//
// Owner: workflow W5-C. Module `economy`.
//
// This module owns no `ScheduledEventKind` of its own, and that is deliberate.
// `PLAYER_SETTLE_SWEEP` already exists, already has a handler in `lib/jobs.ts` and already
// fires every six game hours per player, whether anybody is connected or not; adding a
// second recurring event for the debt policy would double the outbox traffic to observe the
// same balance at the same instants. What `lib/jobs.ts` offers instead is
// `registerSettleSweepHook`, which W3-A wrote for exactly this and which lets the extension
// live in the module that owns the domain without reopening `lib/advancePlayer.ts`
// (plan section 11, rule 3).
//
// Consequence for the metric of the closing note of W3: `farm_world_scheduled_events_unhandled_total`
// counts a due event whose kind has no handler, and `PLAYER_SETTLE_SWEEP` has had one since
// W3. This module adds no kind, so it adds nothing to that counter.
//
// Where the hook runs, and the gap this leaves. `registerEconomySweepHooks` is called by
// `registerEconomyRoutes`, which `src/app.ts` calls: so the server process registers it and
// every path that advances a player through HTTP applies it. The worker process builds no
// Fastify instance — it wires the registries through `src/handlers.ts` and consumes the
// queue — so it does not import this module and does not register the hook. Until one line
// is added to `registerDomainHandlers`, a sweep applied by the worker settles and reschedules
// but does not liquidate. The exact patch, and why an agent of this phase may not apply it,
// are in `docs/handoff/NOTES-w5c.md`, item 2.1.

import { type ScheduledEventContext } from '../../lib/advancePlayer.js';
import { registerSettleSweepHook, type SettleSweepHook } from '../../lib/jobs.js';
import { runForcedLiquidation } from './liquidation.js';

/** Whether this process already registered the hook, so a second app build does not stack it. */
let registered = false;

/**
 * The extension itself: it runs inside the transaction of the advance, after the accruals of
 * the window have been settled, so the balance it reads is the settled one.
 *
 * It logs only when it did something. A sweep that finds no debt is the normal case and runs
 * six times a game day per player; logging it would bury everything else.
 */
export const forcedLiquidationHook: SettleSweepHook = async (
  context: ScheduledEventContext,
): Promise<void> => {
  const outcome = await runForcedLiquidation(context);
  if (outcome.assets.length === 0) {
    return;
  }
  context.services.logger.warn(
    {
      playerId: context.lock.playerId,
      scheduledEventId: context.event.id,
      assets: outcome.assets.length,
      proceeds: outcome.proceeds,
      balanceBefore: outcome.balanceBefore,
      balanceAfter: outcome.balanceAfter,
      stepsRun: outcome.stepsRun,
      stepsSkipped: outcome.stepsSkipped.map((skipped) => skipped.step),
    },
    'forced liquidation applied by the settlement sweep',
  );
};

/**
 * Registers the extension. Idempotent, because the integration suite builds several
 * applications in one process and a stacked hook would liquidate twice per sweep.
 */
export function registerEconomySweepHooks(): void {
  if (registered) {
    return;
  }
  registerSettleSweepHook(forcedLiquidationHook);
  registered = true;
}

/**
 * Forgets the registration. The companion of `resetSettleSweepHooks` of `lib/jobs.ts`, which
 * clears the list this module registered into: without this, a suite that cleared the list
 * could never register again.
 */
export function resetEconomySweepHookRegistration(): void {
  registered = false;
}
