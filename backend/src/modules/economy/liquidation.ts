// Forced liquidation: the third step of the debt policy of plan section 6.6.
//
// Owner: workflow W5-C. Module `economy`.
//
// What it is for. With the values of the GDD left unadjusted, a negative balance is the
// expected state of the first cycle, so `IN_DEBT` alone would be a state a player could stay
// in for ever while the holding costs kept running. Forced liquidation is the bound: past a
// threshold proportional to what the holding is worth, the world sells the player's assets
// for him, in a published order, and says so.
//
// Four properties, and each one is a decision rather than an implementation detail:
//
//   1. The sweep triggers it, never the login. A liquidation that appeared the moment the
//      player came back would read as a punishment for having been away, and the whole point
//      of an asynchronous game is that being away is legitimate. `PLAYER_SETTLE_SWEEP` fires
//      every six game hours per player whether anyone is watching or not, so the liquidation
//      happens when the debt happens.
//   2. The order is `LIQUIDATION_STEPS` of `shared/config/economy.ts` and is never restated
//      here. This module iterates that array; a change of policy is a change of the
//      catalogue, which the balance calculator and the client read as well.
//   3. One ledger entry per asset sold, with `refType` and `refId` pointing at it and the
//      step in `meta`. That is what lets the return summary say "your harvester was sold to
//      cover the debt" instead of showing a single unexplained credit, and it is why the per
//      asset entries use the corresponding sale kinds and not `LIQUIDATION`: the reserved
//      `LIQUIDATION` kind is the aggregate, written once per liquidation with an amount of
//      zero and the whole event in `meta`, because the money has already moved through the
//      per asset entries and counting it twice would break the audit.
//   4. It stops as soon as the balance is no longer negative. Selling more than the debt
//      needs would be confiscation, not liquidation.
//
// A worker cannot be sold, so the `WORKERS` step writes no sale entry: it dismisses, which
// stops the wage accrual, and the dismissal is recorded where every other dismissal is, in
// `Worker.terminatedGameMs`, plus a line in the `meta` of the aggregate entry. Reaching that
// step means every liquid asset is already gone and the debt still stands, so stopping the
// bleeding is the only remaining action that changes the trajectory.
//
// THREE STEPS ARE DECLARED AND INACTIVE, and the reason is ownership rather than difficulty.
// `CANCEL_TASKS` needs the cancellation semantics of `modules/tasks` (prorated wear, release
// of the silo reservation, retirement of the queue job); `BUILDINGS` needs the demolition
// semantics of `modules/farms` (release of the footprint cells and recomputation of the
// storage capacity); `UNUSED_LAND` needs a release of ownership that `modules/world` does not
// expose. Half of any of them would leave the state inconsistent, which is worse than not
// liquidating. They appear in the plan below with their reason, so the outcome reports
// exactly what it could not do, and activating one is adding a function to the table.
// `docs/handoff/NOTES-w5c.md`, items 3.2 to 3.4.

import { type ScheduledEventContext } from '../../lib/advancePlayer.js';
import { toMoney } from '../../lib/dbMap.js';
import { credit } from '../../lib/ledger.js';
import { taskCancellerForLiquidation } from '../../lib/moduleSeams.js';
import { buildPlayerDto, toLedgerEntryDto } from '../../lib/playerView.js';
import { type Tx } from '../../lib/tx.js';
import {
  GameEventType,
  LIQUIDATION_STEPS,
  LedgerType,
  MACHINE_CATALOGUE,
  MachineStatus,
  Money,
  NoticeKind,
  PINE,
  type StockItem,
  WorkerStatus,
  bp,
  ceilDiv,
  liquidationValue,
  machineResaleValue,
  toWireGameMs,
  toWireMoney,
  type FarmId,
  type GameMs,
  type LedgerEntry,
  type LiquidatableHolding,
  type LiquidationStep,
  type MachineId,
  type MachineType,
  type PlayerId,
  type TerrainType,
  type WorkerId,
} from '../../shared/index.js';
import { buildFarmDto } from '../farms/readModel.js';
import { loadFarmStock, loadFarms, withdrawStorage, type FarmStockRow } from '../farms/service.js';
import { debtOf, liquidationTrigger, type LiquidationTrigger } from './debt.js';
import { categoryOfItem, SALE_LEDGER_TYPE, pricePerStoredUnit, saleRevenue } from './market.js';
import { buildInventoryFarms } from './readModel.js';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** What a liquidation did to one asset. One of these per ledger entry it wrote. */
export interface LiquidatedAsset {
  readonly step: LiquidationStep;
  /** `TASK` collects nothing: it records that the step stopped an operating cost. */
  readonly assetKind: 'STOCK' | 'MACHINE' | 'WORKER' | 'TASK';
  readonly assetId: string;
  /** The resource or the machine type, so the summary can name it without a second read. */
  readonly detail: string;
  /** Stored units for stock, one for anything with identity. */
  readonly units: number;
  readonly proceeds: Money;
}

/** A step that did not run, and why. Reported so the outcome is never silently partial. */
export interface SkippedStep {
  readonly step: LiquidationStep;
  readonly reason: string;
}

export interface LiquidationOutcome {
  readonly trigger: LiquidationTrigger;
  readonly assets: readonly LiquidatedAsset[];
  readonly proceeds: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly stepsRun: readonly LiquidationStep[];
  readonly stepsSkipped: readonly SkippedStep[];
  readonly entries: readonly LedgerEntry[];
}

/** The mutable working state of one liquidation. Confined to this module. */
interface LiquidationState {
  readonly context: ScheduledEventContext;
  readonly tx: Tx;
  readonly playerId: PlayerId;
  readonly atGameMs: GameMs;
  balance: Money;
  readonly assets: LiquidatedAsset[];
  readonly entries: LedgerEntry[];
  readonly touchedFarmIds: Set<string>;
  readonly removedMachines: { readonly machineId: string; readonly farmId: string }[];
  readonly removedWorkers: { readonly workerId: string; readonly farmId: string }[];
}

/** How one step of the published order is carried out, or why it is not. */
interface StepPlan {
  readonly step: LiquidationStep;
  readonly reason: string | null;
  readonly run: ((state: LiquidationState) => Promise<void>) | null;
  /**
   * Whether the strategy can run in this process. Only a step whose strategy comes from a
   * registry needs it: registration happens at start-up and this table is built at import
   * time, so the question cannot be answered by whether `run` is null.
   */
  readonly available?: () => boolean;
}

// ---------------------------------------------------------------------------
// The liquidatable holding
// ---------------------------------------------------------------------------

/**
 * What the holding of a player would fetch, which is the denominator of the threshold.
 *
 * Only the machinery a liquidation could actually sell is counted: a machine reserved by a
 * task cannot be disposed of, which the schema enforces with a CHECK, so counting it would
 * raise the threshold on the strength of an asset that is not for sale. Buildings and unused
 * land are counted in full even though their steps are inactive today, so that activating
 * them does not move the threshold and change when a liquidation fires.
 */
export async function loadLiquidatableHolding(
  tx: Tx,
  playerId: PlayerId,
): Promise<LiquidatableHolding> {
  const farms = await loadFarms(tx, playerId);
  const stock = await loadFarmStock(
    tx,
    farms.map((farm) => farm.id),
  );
  const [machines, buildings, landGroups] = await Promise.all([
    tx.machine.findMany({
      where: {
        playerId,
        disposedGameMs: null,
        currentTaskId: null,
        status: MachineStatus.IDLE,
      },
      orderBy: { id: 'asc' },
      select: { type: true, purchasePrice: true, conditionBp: true },
    }),
    tx.building.findMany({
      where: { playerId, disposedGameMs: null },
      orderBy: { id: 'asc' },
      select: { type: true },
    }),
    tx.worldCell.groupBy({
      by: ['generatedTerrain', 'terrainOverride'],
      where: { ownerPlayerId: playerId, fieldId: null, forestPlotId: null, buildingId: null },
      _count: { _all: true },
    }),
  ]);

  const unusedLandCells: TerrainType[] = [];
  for (const group of landGroups) {
    const terrain = group.terrainOverride ?? group.generatedTerrain;
    for (let index = 0; index < group._count._all; index += 1) {
      unusedLandCells.push(terrain);
    }
  }

  return {
    machines: machines.map((machine) => ({
      type: machine.type,
      purchasePrice: toMoney(machine.purchasePrice),
      conditionBp: bp(machine.conditionBp),
    })),
    buildings: buildings.map((building) => building.type),
    unusedLandCells,
    // Summed across the farms of the player and per pile: the threshold of plan section
    // 6.6 asks what the whole holding is worth, and each crop is worth its own price.
    stock: stockTotals(stock),
  };
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

/** Whether the debt is cleared, which is the stopping rule of every step. */
function solvent(state: LiquidationState): boolean {
  return !Money.isNegative(state.balance);
}

/** Writes the entry of one liquidated asset and moves the working balance. */
async function creditAsset(
  state: LiquidationState,
  input: {
    readonly step: LiquidationStep;
    readonly assetKind: LiquidatedAsset['assetKind'];
    readonly assetId: string;
    readonly detail: string;
    readonly units: number;
    readonly proceeds: Money;
    readonly type: LedgerType;
    readonly refType: string;
    readonly meta: Record<string, string | number>;
  },
): Promise<void> {
  const { context } = state;
  const written = await credit(state.tx, context.lock, {
    type: input.type,
    amount: input.proceeds,
    atGameMs: state.atGameMs,
    atRealMs: context.reading.atRealMs,
    idempotencyKey: liquidationKey(context.event.id, input.step, input.assetId),
    refType: input.refType,
    refId: input.assetId,
    meta: { ...input.meta, liquidationStep: input.step, reason: 'FORCED_LIQUIDATION' },
  });
  context.services.metrics.ledgerEntries.inc({ type: input.type });
  state.balance = written.balanceAfter;
  state.entries.push(written.entry);
  state.assets.push({
    step: input.step,
    assetKind: input.assetKind,
    assetId: input.assetId,
    detail: input.detail,
    units: input.units,
    proceeds: input.proceeds,
  });
}

/**
 * Step 1, stock (GDD sections 27, 123 and 136).
 *
 * First because it is fungible and selling it destroys no capability: a silo full of grain is
 * money the player has already earned and has merely not collected. Only the units the debt
 * needs are sold, rounded up, so a player who is a hundred short does not lose the harvest.
 */
async function liquidateInventory(state: LiquidationState): Promise<void> {
  const farms = await loadFarms(state.tx, state.playerId);
  const piles = await loadFarmStock(
    state.tx,
    farms.map((farm) => farm.id),
  );
  // One pile at a time, in the order the piles were loaded, which is by farm and then by
  // item: the sequence has to be deterministic so a liquidation is reproducible.
  for (const pile of piles) {
    if (solvent(state)) {
      return;
    }
    if (pile.storedUnits <= 0) {
      continue;
    }
    const category = categoryOfItem(pile.item);
    const priceScaled = Money.toScaled(pricePerStoredUnit(pile.item));
    if (priceScaled <= 0n) {
      continue;
    }
    const needed = Number(ceilDiv(Money.toScaled(debtOf(state.balance)), priceScaled));
    const units = Math.min(pile.storedUnits, needed);
    if (units <= 0) {
      continue;
    }
    const withdrawal = await withdrawStorage(state.tx, pile.farmId, pile.item, category, units);
    if (!withdrawal.ok) {
      continue;
    }
    state.touchedFarmIds.add(pile.farmId);
    await creditAsset(state, {
      step: 'INVENTORY',
      assetKind: 'STOCK',
      assetId: `${pile.farmId}:${pile.item}`,
      detail: pile.item,
      units,
      proceeds: saleRevenue(pile.item, units),
      type: SALE_LEDGER_TYPE[category],
      refType: 'FARM',
      meta: { farmId: pile.farmId, item: pile.item, category, units, gddSection: 123 },
    });
  }
}

/** The piles of every farm of the player, added up per item. */
function stockTotals(
  piles: readonly FarmStockRow[],
): readonly { readonly item: StockItem; readonly units: number }[] {
  const totals = new Map<StockItem, number>();
  for (const pile of piles) {
    totals.set(pile.item, (totals.get(pile.item) ?? 0) + pile.storedUnits);
  }
  return [...totals].map(([item, units]) => ({ item, units }));
}

/**
 * Step 2, idle machinery (GDD sections 93, 96 and 98).
 *
 * Only machines that are idle and reserved by no task: the schema forbids disposing of a
 * machine a task holds, and a liquidation that abandoned a task halfway would leave the
 * player worse off than the debt did. In ascending order of identifier, which is step 3 of
 * the canonical lock order and, incidentally, makes the outcome reproducible in a test.
 *
 * The price is `machineResaleValue`, the same shared rule the voluntary sale of
 * `POST /api/machines/:id/sell` uses, so a forced sale never pays a different figure from
 * the one the panel was quoting.
 */
async function liquidateIdleMachines(state: LiquidationState): Promise<void> {
  const machines = await state.tx.machine.findMany({
    where: {
      playerId: state.playerId,
      disposedGameMs: null,
      currentTaskId: null,
      status: MachineStatus.IDLE,
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      farmId: true,
      type: true,
      purchasePrice: true,
      conditionBp: true,
      acquiredGameMs: true,
    },
  });

  for (const machine of machines) {
    if (solvent(state)) {
      return;
    }
    const paid = toMoney(machine.purchasePrice);
    const proceeds = machineResaleValue({
      purchasePrice: Money.isZero(paid)
        ? MACHINE_CATALOGUE[machine.type as MachineType].purchasePrice
        : paid,
      conditionBp: bp(machine.conditionBp),
    });
    // The disposal instant never precedes the acquisition, which `machines_life_check`
    // requires. The sweep is applied at its due instant, so the two only differ if a machine
    // was acquired after an event that had not been processed yet.
    const disposedGameMs =
      machine.acquiredGameMs > state.atGameMs ? machine.acquiredGameMs : state.atGameMs;
    const disposed = await state.tx.machine.updateMany({
      where: { id: machine.id, disposedGameMs: null, currentTaskId: null },
      data: { disposedGameMs },
    });
    if (disposed.count === 0) {
      continue;
    }
    state.removedMachines.push({ machineId: machine.id, farmId: machine.farmId });
    state.touchedFarmIds.add(machine.farmId);
    await creditAsset(state, {
      step: 'IDLE_MACHINES',
      assetKind: 'MACHINE',
      assetId: machine.id,
      detail: machine.type,
      units: 1,
      proceeds,
      type: LedgerType.MACHINE_SALE,
      refType: 'MACHINE',
      meta: {
        machineType: machine.type,
        conditionBp: machine.conditionBp,
        farmId: machine.farmId,
        gddSection: 96,
      },
    });
  }
}

/**
 * Step 4, workers (GDD sections 36, 107 and 109).
 *
 * A worker is not an asset that can be sold, so this step writes no sale entry: what it does
 * is stop the wage accrual, which is the only thing left that changes the trajectory once
 * every liquid asset is gone. Only idle workers, because GDD section 109 forbids dismissing
 * one in the middle of a task and the schema enforces it with a CHECK and a trigger.
 *
 * It is not bounded by the debt the way the selling steps are: dismissing one worker frees no
 * money, so a stopping rule based on the balance would dismiss the whole payroll one row at a
 * time anyway. Reaching this step means the holding could not cover its debt, and the whole
 * idle payroll is what the policy stops.
 */
async function liquidateWorkers(state: LiquidationState): Promise<void> {
  const workers = await state.tx.worker.findMany({
    where: {
      playerId: state.playerId,
      terminatedGameMs: null,
      currentTaskId: null,
      status: WorkerStatus.IDLE,
    },
    orderBy: { id: 'asc' },
    select: { id: true, farmId: true, name: true, hiredGameMs: true },
  });

  for (const worker of workers) {
    const terminatedGameMs =
      worker.hiredGameMs > state.atGameMs ? worker.hiredGameMs : state.atGameMs;
    const dismissed = await state.tx.worker.updateMany({
      where: { id: worker.id, terminatedGameMs: null, currentTaskId: null },
      data: { terminatedGameMs },
    });
    if (dismissed.count === 0) {
      continue;
    }
    state.removedWorkers.push({ workerId: worker.id, farmId: worker.farmId });
    state.touchedFarmIds.add(worker.farmId);
    state.assets.push({
      step: 'WORKERS',
      assetKind: 'WORKER',
      assetId: worker.id,
      detail: worker.name,
      units: 1,
      proceeds: Money.ZERO,
    });
  }
}

/**
 * The published order, with the strategy of each step.
 *
 * Keyed by the union so that a step added to `LIQUIDATION_STEPS` does not compile until it
 * has either a strategy or a reason for not having one, which is what keeps this table and
 * the catalogue from drifting apart in silence.
 */
const STEP_PLAN: Readonly<Record<LiquidationStep, StepPlan>> = {
  INVENTORY: { step: 'INVENTORY', reason: null, run: liquidateInventory },
  IDLE_MACHINES: { step: 'IDLE_MACHINES', reason: null, run: liquidateIdleMachines },
  // The strategy lives in `modules/tasks`, which is a later phase and therefore unreachable
  // from here by import (plan section 11, rule 4). `src/handlers.ts` registers it in
  // `lib/moduleSeams.ts`, and `available` is what keeps the step honest when it is not
  // registered: the outcome reports it among the steps that did not run, with its reason,
  // instead of silently doing nothing (docs/handoff/NOTES-w6a.md 2.1).
  CANCEL_TASKS: {
    step: 'CANCEL_TASKS',
    reason:
      'La cancelacion de una tarea es de modules/tasks (W6-A) y su estrategia no esta ' +
      'registrada en este proceso.',
    available: () => taskCancellerForLiquidation() !== null,
    run: async (state) => {
      const canceller = taskCancellerForLiquidation();
      if (canceller === null) {
        return;
      }
      // It collects nothing: what it buys is stopping the operating cost of GDD section 94
      // and handing the machinery back to `IDLE`, which is what gives `IDLE_MACHINES`
      // something to sell on the next sweep. So it neither touches `state.balance` nor
      // writes an entry of its own, exactly like `WORKERS`.
      for (const cancelled of await canceller(state.context, state.atGameMs)) {
        state.assets.push({
          step: 'CANCEL_TASKS',
          assetKind: 'TASK',
          assetId: cancelled.taskId,
          detail: cancelled.operation,
          units: 1,
          proceeds: Money.ZERO,
        });
      }
    },
  },
  WORKERS: { step: 'WORKERS', reason: null, run: liquidateWorkers },
  BUILDINGS: {
    step: 'BUILDINGS',
    reason:
      'La demolicion de un edificio es de modules/farms (W4-B): liberacion de las celdas ' +
      'de la huella y recalculo de la capacidad de almacenamiento.',
    run: null,
  },
  UNUSED_LAND: {
    step: 'UNUSED_LAND',
    reason:
      'La devolucion de propiedad de una celda no la expone modules/world (W3-B): ' +
      'haria falta el simetrico de claimCells con el incremento de version de chunk.',
    run: null,
  },
};

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Idempotency key of the entry of one asset.
 *
 * It carries the identifier of the scheduled event and not the instant: the event is claimed
 * by a conditional status update before the handler runs, so a duplicate delivery applies
 * nothing, and the key is the second, independent defence of plan section 6.3 for the case
 * where it did.
 */
export function liquidationKey(
  scheduledEventId: string,
  step: LiquidationStep | 'SUMMARY',
  assetId: string,
): string {
  return `liquidation:${scheduledEventId}:${step}:${assetId}`;
}

/**
 * Runs a forced liquidation if the debt has passed the threshold.
 *
 * Everything happens inside the transaction of the advance, with the player row already
 * locked and the accruals already settled up to the due instant of the event, so the balance
 * it compares against is the settled one and not a projection.
 */
export async function runForcedLiquidation(
  context: ScheduledEventContext,
): Promise<LiquidationOutcome> {
  const tx = context.tx;
  const playerId = context.lock.playerId;
  const player = await tx.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { balance: true },
  });
  const balanceBefore = toMoney(player.balance);
  const holding = await loadLiquidatableHolding(tx, playerId);
  const trigger = liquidationTrigger(balanceBefore, liquidationValue(holding, { species: PINE }));

  if (!trigger.triggered) {
    return {
      trigger,
      assets: [],
      proceeds: Money.ZERO,
      balanceBefore,
      balanceAfter: balanceBefore,
      stepsRun: [],
      stepsSkipped: [],
      entries: [],
    };
  }

  const state: LiquidationState = {
    context,
    tx,
    playerId,
    atGameMs: context.event.dueGameMs,
    balance: balanceBefore,
    assets: [],
    entries: [],
    touchedFarmIds: new Set<string>(),
    removedMachines: [],
    removedWorkers: [],
  };

  const stepsRun: LiquidationStep[] = [];
  const stepsSkipped: SkippedStep[] = [];

  // The published order, read from the catalogue and never restated here.
  for (const step of LIQUIDATION_STEPS) {
    if (solvent(state)) {
      break;
    }
    const plan = STEP_PLAN[step];
    if (plan.run === null || plan.available?.() === false) {
      stepsSkipped.push({ step, reason: plan.reason ?? 'Sin estrategia declarada.' });
      continue;
    }
    await plan.run(state);
    stepsRun.push(step);
  }

  const proceeds = Money.sum(state.assets.map((asset) => asset.proceeds));
  if (state.assets.length > 0) {
    await writeSummaryEntry(state, trigger, proceeds, balanceBefore, stepsRun, stepsSkipped);
    await emitFrames(state, trigger, proceeds);
  }

  return {
    trigger,
    assets: state.assets,
    proceeds,
    balanceBefore,
    balanceAfter: state.balance,
    stepsRun,
    stepsSkipped,
    entries: state.entries,
  };
}

/**
 * The aggregate entry of the liquidation, of kind `LIQUIDATION` and amount zero.
 *
 * Zero because the money already moved through the per asset entries and the ledger is
 * auditable precisely because the sum of its entries equals the balance; what this entry
 * carries is the explanation, which is what the return summary of plan section 6.7 reads.
 * It is written last, so it can report what the whole run did.
 */
async function writeSummaryEntry(
  state: LiquidationState,
  trigger: LiquidationTrigger,
  proceeds: Money,
  balanceBefore: Money,
  stepsRun: readonly LiquidationStep[],
  stepsSkipped: readonly SkippedStep[],
): Promise<void> {
  const { context } = state;
  const written = await credit(state.tx, context.lock, {
    type: LedgerType.LIQUIDATION,
    amount: Money.ZERO,
    atGameMs: state.atGameMs,
    atRealMs: context.reading.atRealMs,
    idempotencyKey: liquidationKey(context.event.id, 'SUMMARY', state.playerId),
    refType: 'PLAYER',
    refId: state.playerId,
    meta: {
      debtBefore: toWireMoney(debtOf(balanceBefore)),
      balanceBefore: toWireMoney(balanceBefore),
      balanceAfter: toWireMoney(state.balance),
      liquidatableValue: toWireMoney(trigger.liquidatable.total),
      thresholdBp: trigger.thresholdBp,
      thresholdAmount: toWireMoney(trigger.thresholdAmount),
      proceeds: toWireMoney(proceeds),
      assetCount: state.assets.length,
      stepsRun: [...stepsRun],
      stepsSkipped: stepsSkipped.map((skipped) => skipped.step),
      assets: state.assets.map((asset) => ({
        step: asset.step,
        kind: asset.assetKind,
        id: asset.assetId,
        detail: asset.detail,
        units: asset.units,
        proceeds: toWireMoney(asset.proceeds),
      })),
      planSection: '6.6',
    },
  });
  context.services.metrics.ledgerEntries.inc({ type: LedgerType.LIQUIDATION });
  state.entries.push(written.entry);
}

/**
 * The frames a liquidation produces, in the order a reducer wants them: what disappeared
 * first, then the containers that changed, then the money, then the notice that explains it.
 *
 * They are appended with the due instant of the event and not with "now", so a liquidation
 * applied late by a worker that had been down is placed where it happened.
 */
async function emitFrames(
  state: LiquidationState,
  trigger: LiquidationTrigger,
  proceeds: Money,
): Promise<void> {
  const { context } = state;

  for (const removed of state.removedMachines) {
    context.emit({
      type: GameEventType.MACHINE_REMOVED,
      payload: {
        machineId: removed.machineId as MachineId,
        farmId: removed.farmId as FarmId,
      },
    });
  }
  for (const removed of state.removedWorkers) {
    context.emit({
      type: GameEventType.WORKER_REMOVED,
      payload: {
        workerId: removed.workerId as WorkerId,
        farmId: removed.farmId as FarmId,
      },
    });
  }

  const inventory = await buildInventoryFarms(state.tx, state.playerId);
  if (inventory.length > 0) {
    context.emit({ type: GameEventType.INVENTORY_UPSERTED, payload: { farms: [...inventory] } });
  }
  for (const farmId of [...state.touchedFarmIds].sort()) {
    context.emit({
      type: GameEventType.FARM_UPSERTED,
      payload: { farm: await buildFarmDto(state.tx, farmId) },
    });
  }

  context.emit({
    type: GameEventType.PLAYER_UPSERTED,
    payload: { player: await buildPlayerDto(state.tx, state.playerId, context.reading) },
  });
  if (state.entries.length > 0) {
    context.emit({
      type: GameEventType.LEDGER_APPENDED,
      payload: {
        entries: state.entries.map(toLedgerEntryDto),
        balance: toWireMoney(state.balance),
      },
    });
  }
  context.emit({
    type: GameEventType.NOTICE,
    payload: {
      notice: {
        kind: NoticeKind.FORCED_LIQUIDATION,
        severity: 'WARNING',
        code: null,
        message:
          `Se liquidaron ${state.assets.length} activos por ${Money.toDisplay(proceeds)} ` +
          'para cubrir la deuda.',
        details: {
          proceeds: toWireMoney(proceeds),
          debtBefore: toWireMoney(trigger.debt),
          balanceAfter: toWireMoney(state.balance),
          assetCount: state.assets.length,
        },
        atGameMs: toWireGameMs(state.atGameMs),
        subjectType: 'PLAYER',
        subjectId: state.playerId,
      },
    },
  });
}
