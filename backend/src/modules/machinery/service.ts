// The writing side of the `machinery` area: buying, selling, repairing and wearing out.
//
// Owner: workflow W5-A. Module `machinery`.
//
// Everything that decides anything lives here; `routes.ts` is the conversion between the
// wire types and the domain types and nothing else, which is the shape `land` and `farms`
// already use. The row and its derived readings are in `record.ts`.
//
// THE FOUR RULES OF THE GDD THIS MODULE ENFORCES, and where each one really lives:
//
//   1. A machine cannot be bought without a free garage slot (GDD section 96, "bloqueo
//      simple"). The rule is `requireGarageSlot` of `modules/farms/service.ts`: the counter
//      `Building.machineCount` is maintained by the trigger `machines_garage_occupancy` and
//      bounded by `buildings_capacity_check`, and this module never recomputes either.
//   2. Repair requires a workshop and costs `(100 - condition) x repairCostPerPoint` (GDD
//      sections 29 and 93). The rule is `canRepairMachine` and `repairCost` of
//      `shared/rules/machinery.ts`, so the client greys the button out for the same reason
//      the server answers 409.
//   3. Wear is per hour worked and never per hour idle (GDD sections 93 and 99). The rule is
//      `conditionAfterWork` of `shared/rules/machinery.ts` and the rate is in the catalogue.
//   4. `maintenanceCost` is paid always and `operatingCost` only while the machine works
//      (GDD section 94). Neither is charged here: both are integrals over validity
//      intervals, computed by `lib/accrual.ts` from `acquiredGameMs` and `disposedGameMs`,
//      so this module's whole contribution to the running costs is writing those two
//      instants at the right moment. A purchase opens the interval and a sale closes it;
//      nothing else in the system moves either.
//
// WHY REPAIR IS A SCHEDULED EVENT AND WHAT SURVIVES IN THE ROW. Plan section 2.2 turns the
// repair of GDD section 93, which has no duration at all, into an event whose length is
// proportional to the points restored, and that is what makes `IN_REPAIR` a real state
// instead of a reserved one (GDD section 95). The payload of a scheduled event carries
// identifiers and nothing else (plan section 6.4), and the schema has no column for a repair
// target either. It needs neither: the length of the repair IS the number of points bought,
// so `record.ts` derives the target from `repairEndsAtGameMs` and `conditionUpdatedAtGameMs`,
// and the handler recomputes what the request bought instead of remembering it. That is the
// same discipline `modules/fields` follows with the projected phase.
//
// BROKEN is never written. Random breakdowns are outside the strict MVP because they are
// unfair in idle play, and GDD section 95 asks only that the value exist in the enum.

import { type MutationContext } from '../../lib/advancePlayer.js';
import { fromMoney, toMoney } from '../../lib/dbMap.js';
import { scheduledEventDedupeKey } from '../../lib/ids.js';
import { charge, credit } from '../../lib/ledger.js';
import { buildPlayerDto, toLedgerEntryDto } from '../../lib/playerView.js';
import { cancelScheduledEventsFor, scheduleEvent } from '../../lib/scheduler.js';
import { type Db, type Tx } from '../../lib/tx.js';
import {
  ApiError,
  BP_ONE,
  BuildingType,
  GameEventType,
  LedgerType,
  MIN_CONDITION_TO_ASSIGN,
  MachineStatus,
  Money,
  ScheduledEventKind,
  TaskStatus,
  ValidationCode,
  addGameMs,
  canRepairMachine,
  clampBp,
  conditionAfterWork,
  gameHoursBetween,
  insufficientFunds,
  notFound,
  spendingBlockedInDebt,
  toWireMoney,
  validationFailed,
  type Bp,
  type GameMs,
  type LedgerEntry,
  type MachineType,
  type PlayerId,
  type SlotUsage,
} from '../../shared/index.js';
import { withConstraintTranslation } from '../farms/constraints.js';
import { toBuildingDto } from '../farms/readModel.js';
import {
  buildingsWithFreeSlot,
  hasWorkshop,
  loadBuildings,
  requireFarm,
  requireGarageSlot,
  slotUsageOf,
  type BuildingRow,
  type BuildingSlot,
} from '../farms/service.js';
import { machineUpsertedFrame } from './readModel.js';
import {
  MACHINE_REF_TYPE,
  MACHINE_SELECT,
  assignmentError,
  definitionOf,
  machineAssignmentRefusal,
  repairCostBetween,
  repairDurationBetween,
  requireMachine,
  resaleValueOf,
  scheduledRestorationBp,
  toRecord,
  type MachineRecord,
} from './record.js';

// ---------------------------------------------------------------------------
// Garages
// ---------------------------------------------------------------------------

/** The garages of a farm, in ascending identifier order. */
async function garagesOf(db: Db, farmId: string): Promise<readonly BuildingRow[]> {
  const buildings = await loadBuildings(db, [farmId]);
  return buildings.filter((building) => building.type === BuildingType.GARAGE);
}

/** Garage occupancy of a farm, aggregated over its live garages (GDD section 96). */
export async function garageSlotsOf(db: Db, farmId: string): Promise<SlotUsage> {
  return slotUsageOf(await garagesOf(db, farmId), 'MACHINES');
}

/**
 * The garage a new machine goes into (GDD section 96).
 *
 * With no garage named the choice is the rule of `farms/service.ts`, which takes the lowest
 * identifier among those with room so that two purchases fill one garage before starting the
 * next and the choice is reproducible in a test. With one named, the refusal has to
 * distinguish "that is not a garage of this farm" from "that garage is full", because the
 * panel offers a list and the two mean different things to the player.
 */
async function resolveGarageSlot(
  db: Db,
  farmId: string,
  garageId: string | null,
): Promise<BuildingSlot> {
  if (garageId === null) {
    return requireGarageSlot(db, farmId);
  }
  const free = await buildingsWithFreeSlot(db, farmId, BuildingType.GARAGE);
  const slot = free.find((candidate) => candidate.buildingId === garageId);
  if (slot !== undefined) {
    return slot;
  }
  const row = (await garagesOf(db, farmId)).find((building) => building.id === garageId);
  if (row === undefined) {
    throw notFound('Building', garageId);
  }
  throw new ApiError(ValidationCode.GARAGE_CAPACITY_EXCEEDED, {
    entityId: row.id,
    occupancy: row.machineCount,
    capacity: row.capacityMachines,
  });
}

// ---------------------------------------------------------------------------
// Assignment and wear: the pieces the task engine of workflow W6 consumes
// ---------------------------------------------------------------------------

/**
 * The machines a task is about to reserve, or the refusal of the first one that cannot be.
 *
 * Written for `modules/tasks` of workflow W6-A, which is a later phase and may import this
 * module, so the condition floor of plan section 2.2 has one implementation and the task
 * engine has none of it. The identifiers are read in ascending order, which is step 3 of the
 * canonical lock order of `lib/tx.ts`: a caller that goes on to update them cannot deadlock
 * with a concurrent assignment that names the same two machines the other way round.
 */
export async function requireAssignableMachines(
  db: Db,
  playerId: PlayerId,
  machineIds: readonly string[],
  minConditionBp: Bp = MIN_CONDITION_TO_ASSIGN,
): Promise<readonly MachineRecord[]> {
  const ordered = [...new Set(machineIds)].sort();
  const machines: MachineRecord[] = [];
  for (const machineId of ordered) {
    const machine = await requireMachine(db, playerId, machineId);
    if (machineAssignmentRefusal(machine, minConditionBp) !== null) {
      throw assignmentError(machine, minConditionBp);
    }
    machines.push(machine);
  }
  return machines;
}

/**
 * Applies the wear of a stretch of work to a set of machines (GDD section 93).
 *
 * This is the piece the task engine of workflow W6 calls when a task completes and when a
 * task is cancelled, and the two cases differ only in the number of hours passed: a
 * cancellation applies the wear of the hours it actually ran, prorated, and refunds nothing
 * (plan section 2.2, resolution of GDD sections 106 and 111).
 *
 * Three properties the caller relies on. Degradation while idle is outside the MVP (GDD
 * sections 93 and 99), so the mark only moves when hours are accounted for. A stretch of
 * zero or less is a no-op rather than an error, because a task cancelled in the instant it
 * started legitimately worked nothing. And the write is skipped when the mark is already at
 * or past the instant given, which makes a repeated delivery of the same completion harmless
 * in the same way the idempotency key of the ledger is.
 */
export async function applyMachineWear(
  tx: Tx,
  machineIds: readonly string[],
  gameHoursWorked: number,
  atGameMs: GameMs,
): Promise<readonly MachineRecord[]> {
  const hours = gameHoursWorked > 0 ? gameHoursWorked : 0;
  const ordered = [...new Set(machineIds)].sort();
  const updated: MachineRecord[] = [];
  for (const machineId of ordered) {
    const row = await tx.machine.findUnique({ where: { id: machineId }, select: MACHINE_SELECT });
    if (row === null || row.disposedGameMs !== null) {
      continue;
    }
    const machine = toRecord(row);
    if (hours === 0 || machine.conditionUpdatedAtGameMs >= atGameMs) {
      updated.push(machine);
      continue;
    }
    const conditionBp = conditionAfterWork(machine.conditionBp, hours, definitionOf(machine.type));
    const written = await tx.machine.update({
      where: { id: machine.id },
      data: { conditionBp, conditionUpdatedAtGameMs: atGameMs },
      select: MACHINE_SELECT,
    });
    updated.push(toRecord(written));
  }
  return updated;
}

/**
 * The wear of an interval of work, which is the form a task holds its figures in.
 *
 * `[startGameMs, endedGameMs)` is exactly the interval the operating cost of plan section
 * 6.2 integrates over, so the hours that wear a machine and the hours it is billed for are
 * the same hours by construction.
 */
export async function applyMachineWearOverInterval(
  tx: Tx,
  machineIds: readonly string[],
  fromGameMs: GameMs,
  toGameMsValue: GameMs,
): Promise<readonly MachineRecord[]> {
  return applyMachineWear(
    tx,
    machineIds,
    gameHoursBetween(fromGameMs, toGameMsValue),
    toGameMsValue,
  );
}

// ---------------------------------------------------------------------------
// Buying (GDD sections 89 and 96)
// ---------------------------------------------------------------------------

export interface BuyMachineInput {
  readonly farmId: string;
  readonly type: MachineType;
  /** Garage the player named, or null to let the server pick the first one with room. */
  readonly garageId: string | null;
  readonly expectedTotal: Money | null;
  readonly idempotencyKey: string;
}

export interface BuyMachineOutcome {
  readonly machine: MachineRecord;
  readonly totalPaid: Money;
  readonly balanceAfter: Money;
  readonly garageSlots: SlotUsage;
}

/**
 * Buys a machine.
 *
 * The order is fixed and every step depends on the one before:
 *
 *   1. The farm, which must exist and belong to the player.
 *   2. The garage slot. This is the "bloqueo simple" of GDD section 96, answered before the
 *      insert so that the refusal carries the occupancy figures; the `CHECK` on the row
 *      stays as the safety net for a genuine race (ADR-0018).
 *   3. The price of the catalogue, and the quote the client showed, so a stale price is
 *      refused rather than silently charged.
 *   4. Affordability against the settled balance, read under the player lock. Buying is
 *      discretionary spending, which a negative balance blocks (plan section 6.6).
 *   5. The row, with condition 100 (GDD section 93) and `acquiredGameMs`, which is the start
 *      of the validity interval the maintenance accrual of GDD section 94 integrates over.
 *   6. The charge and the frames.
 */
export async function buyMachine(
  ctx: MutationContext,
  input: BuyMachineInput,
): Promise<BuyMachineOutcome> {
  const { tx, reading, lock, services } = ctx;
  const playerId = lock.playerId;

  const farm = await requireFarm(tx, playerId, input.farmId);
  const slot = await resolveGarageSlot(tx, farm.id, input.garageId);

  const price = definitionOf(input.type).purchasePrice;
  if (input.expectedTotal !== null && Money.compare(price, input.expectedTotal) !== 0) {
    throw validationFailed('body.expectedTotal', {
      expected: toWireMoney(price),
      actual: toWireMoney(input.expectedTotal),
    });
  }

  await requireAffordable(tx, playerId, price);

  const created = await withConstraintTranslation(
    () =>
      tx.machine.create({
        data: {
          playerId,
          farmId: farm.id,
          garageId: slot.buildingId,
          // A new machine is at full condition (GDD section 93), and the mark is the instant
          // the condition was settled at, which for a machine that never worked is the
          // purchase itself.
          conditionBp: BP_ONE,
          conditionUpdatedAtGameMs: reading.gameNow,
          type: input.type,
          status: MachineStatus.IDLE,
          // The price actually paid and not the catalogue one, so the resale value stays
          // auditable after a retune of the balance (backend/prisma/schema.prisma).
          purchasePrice: fromMoney(price),
          acquiredGameMs: reading.gameNow,
        },
        select: MACHINE_SELECT,
      }),
    { buildingType: BuildingType.GARAGE, entityId: slot.buildingId },
  );
  const machine = toRecord(created);

  const charged = await charge(tx, lock, {
    type: LedgerType.MACHINE_PURCHASE,
    amount: price,
    atGameMs: reading.gameNow,
    atRealMs: reading.atRealMs,
    idempotencyKey: input.idempotencyKey,
    refType: MACHINE_REF_TYPE,
    refId: machine.id,
    meta: { machineType: machine.type, gddSection: 89 },
  });
  if (!charged.ok) {
    throw insufficientFunds(toWireMoney(charged.required), toWireMoney(charged.available));
  }
  services.metrics.ledgerEntries.inc({ type: LedgerType.MACHINE_PURCHASE });

  ctx.emit(machineUpsertedFrame(machine));
  await emitGarageAndMoney(
    ctx,
    { farmId: farm.id, garageId: slot.buildingId },
    charged.entry,
    charged.balanceAfter,
  );

  return {
    machine,
    totalPaid: price,
    balanceAfter: charged.balanceAfter,
    garageSlots: await garageSlotsOf(tx, farm.id),
  };
}

// ---------------------------------------------------------------------------
// Selling
// ---------------------------------------------------------------------------

export interface SellMachineInput {
  readonly machineId: string;
  readonly idempotencyKey: string;
}

export interface SellMachineOutcome {
  readonly machine: MachineRecord;
  readonly refund: Money;
  readonly balanceAfter: Money;
  readonly garageSlots: SlotUsage;
}

/**
 * Sells a machine back and frees its garage slot.
 *
 * A logical deletion, like the demolition of a building: the row stays with
 * `disposedGameMs`, because the ledger entry that paid for it points at its identifier
 * without a foreign key and a hard delete would destroy the trail (ADR-0009). That instant
 * is also the close of the validity interval, so the maintenance of GDD section 94 stops
 * accruing exactly then and not whenever the next settlement happens to run.
 *
 * The garage slot is freed by the trigger `machines_garage_occupancy`, which reacts to
 * `disposedGameMs` becoming non null. This module does not touch the counter, for the same
 * reason it does not recompute it when buying.
 *
 * A machine that is not idle cannot be sold, and `MACHINE_NOT_IDLE` covers the three ways
 * that can be true: the status, the reservation column and the link table of the task. They
 * are the same fact seen from three places, and a sale that slipped through one of them
 * would leave a task in progress pointing at a machine that no longer exists.
 */
export async function sellMachine(
  ctx: MutationContext,
  input: SellMachineInput,
): Promise<SellMachineOutcome> {
  const { tx, reading, lock, services } = ctx;
  const playerId = lock.playerId;

  const machine = await requireMachine(tx, playerId, input.machineId);
  if (machine.status !== MachineStatus.IDLE || machine.currentTaskId !== null) {
    throw notIdle(machine);
  }
  const reserved = await tx.taskMachine.count({
    where: { machineId: machine.id, task: { status: TaskStatus.IN_PROGRESS } },
  });
  if (reserved > 0) {
    throw notIdle(machine);
  }

  // A pending repair of a machine that is being sold would fall due against a disposed row.
  // The handler tolerates that, but leaving the alarm clock behind would schedule a fact for
  // something that no longer exists.
  await cancelScheduledEventsFor(tx, ctx.outbox, playerId, MACHINE_REF_TYPE, machine.id);

  const garageId = machine.garageId;
  const sold = toRecord(
    await tx.machine.update({
      where: { id: machine.id },
      data: { disposedGameMs: reading.gameNow },
      select: MACHINE_SELECT,
    }),
  );

  const refund = resaleValueOf(machine);
  const refunded = await credit(tx, lock, {
    type: LedgerType.MACHINE_SALE,
    amount: refund,
    atGameMs: reading.gameNow,
    atRealMs: reading.atRealMs,
    idempotencyKey: input.idempotencyKey,
    refType: MACHINE_REF_TYPE,
    refId: machine.id,
    meta: { machineType: machine.type, conditionBp: machine.conditionBp },
  });
  services.metrics.ledgerEntries.inc({ type: LedgerType.MACHINE_SALE });

  ctx.emit({
    type: GameEventType.MACHINE_REMOVED,
    payload: { machineId: machine.id, farmId: machine.farmId },
  });
  await emitGarageAndMoney(
    ctx,
    { farmId: machine.farmId, garageId },
    refunded.entry,
    refunded.balanceAfter,
  );

  return {
    machine: sold,
    refund,
    balanceAfter: refunded.balanceAfter,
    garageSlots: await garageSlotsOf(tx, machine.farmId),
  };
}

// ---------------------------------------------------------------------------
// Repair (GDD sections 29 and 93)
// ---------------------------------------------------------------------------

export interface RepairMachineInput {
  readonly machineId: string;
  /** Target condition, or null for a full restoration. */
  readonly toConditionBp: Bp | null;
  readonly expectedTotal: Money | null;
  readonly idempotencyKey: string;
}

export interface RepairMachineOutcome {
  readonly machine: MachineRecord;
  readonly pointsRestored: number;
  readonly totalPaid: Money;
  readonly balanceAfter: Money;
  readonly repairEndsAtGameMs: GameMs;
}

/**
 * Schedules a repair in the workshop (GDD sections 29 and 93, plan section 2.2).
 *
 * The preconditions are the shared rule and only the shared rule: a workshop on the farm, a
 * machine that is not already at full condition, and a machine that is neither working nor
 * already being repaired. Their order is the order of `canRepairMachine` and it matters: a
 * farm with no workshop is answered with `WORKSHOP_REQUIRED` whatever else is true of the
 * machine, because that is the building the player has to raise first.
 *
 * The machine goes to `IN_REPAIR` and stays there until the event falls due, which is what
 * makes the state real rather than reserved, and the repair consumes no worker.
 */
export async function repairMachine(
  ctx: MutationContext,
  input: RepairMachineInput,
): Promise<RepairMachineOutcome> {
  const { tx, reading, lock, services } = ctx;
  const playerId = lock.playerId;

  const machine = await requireMachine(tx, playerId, input.machineId);
  const refusal = canRepairMachine(
    { type: machine.type, conditionBp: machine.conditionBp, status: machine.status },
    await hasWorkshop(tx, machine.farmId),
  );
  if (refusal !== null) {
    throw new ApiError(refusal, { entityId: machine.id, entityKind: machine.type });
  }

  const targetBp = input.toConditionBp === null ? BP_ONE : input.toConditionBp;
  if (targetBp <= machine.conditionBp) {
    // Not a rule of the game but a request that asks for nothing: the contract types
    // `pointsRestored` as a positive whole number, so no reply describes this.
    throw validationFailed('body.toConditionBp', {
      conditionBp: machine.conditionBp,
      expected: String(machine.conditionBp + 1),
      actual: String(targetBp),
    });
  }

  const price = repairCostBetween(machine.conditionBp, targetBp, definitionOf(machine.type));
  if (input.expectedTotal !== null && Money.compare(price, input.expectedTotal) !== 0) {
    throw validationFailed('body.expectedTotal', {
      expected: toWireMoney(price),
      actual: toWireMoney(input.expectedTotal),
    });
  }

  await requireAffordable(tx, playerId, price);

  const repairEndsAtGameMs = addGameMs(
    reading.gameNow,
    repairDurationBetween(machine.conditionBp, targetBp),
  );

  const updated = toRecord(
    await tx.machine.update({
      where: { id: machine.id },
      data: {
        status: MachineStatus.IN_REPAIR,
        repairEndsAtGameMs,
        // The condition is settled now, and it cannot move while the machine is in the
        // workshop, so this is also the start of the repair. `scheduledRestorationBp` reads
        // the pair back, which is what lets the handler recompute the target.
        conditionUpdatedAtGameMs: reading.gameNow,
      },
      select: MACHINE_SELECT,
    }),
  );

  await scheduleEvent(tx, ctx.outbox, reading, {
    playerId,
    kind: ScheduledEventKind.MACHINE_REPAIR_COMPLETE,
    dueGameMs: repairEndsAtGameMs,
    refType: MACHINE_REF_TYPE,
    refId: machine.id,
    dedupeKey: scheduledEventDedupeKey(ScheduledEventKind.MACHINE_REPAIR_COMPLETE, machine.id),
  });

  const charged = await charge(tx, lock, {
    type: LedgerType.MACHINE_REPAIR,
    amount: price,
    atGameMs: reading.gameNow,
    atRealMs: reading.atRealMs,
    idempotencyKey: input.idempotencyKey,
    refType: MACHINE_REF_TYPE,
    refId: machine.id,
    meta: {
      machineType: machine.type,
      fromConditionBp: machine.conditionBp,
      toConditionBp: targetBp,
      gddSection: 93,
    },
  });
  if (!charged.ok) {
    throw insufficientFunds(toWireMoney(charged.required), toWireMoney(charged.available));
  }
  services.metrics.ledgerEntries.inc({ type: LedgerType.MACHINE_REPAIR });

  ctx.emit(machineUpsertedFrame(updated));
  ctx.emit({
    type: GameEventType.PLAYER_UPSERTED,
    payload: { player: await buildPlayerDto(tx, playerId, reading) },
  });
  ctx.emit({
    type: GameEventType.LEDGER_APPENDED,
    payload: {
      entries: [toLedgerEntryDto(charged.entry)],
      balance: toWireMoney(charged.balanceAfter),
    },
  });

  return {
    machine: updated,
    // Whole points, which is the unit GDD section 93 states the formula in and the unit the
    // contract types this field as. The restoration itself is exact in basis points, so a
    // machine whose condition is not a whole number of points reports the point it is in.
    pointsRestored: Math.ceil((targetBp - machine.conditionBp) / 100),
    totalPaid: price,
    balanceAfter: charged.balanceAfter,
    repairEndsAtGameMs,
  };
}

/**
 * Completes a scheduled repair: the condition is restored and the machine returns to `IDLE`.
 *
 * Called by the handler of `MACHINE_REPAIR_COMPLETE` inside the transaction of the advance,
 * after the event has been claimed. The instant written is the due one and not the current
 * one, so a job that ran late places the change where it happened (plan section 6.4).
 *
 * `repairEndsAtGameMs` goes back to null in the same statement as the status, because
 * `machines_repair_check` only allows a repair end on a machine that is `IN_REPAIR`.
 */
export async function completeRepair(
  tx: Tx,
  machine: MachineRecord,
  dueGameMs: GameMs,
): Promise<MachineRecord> {
  const conditionBp = clampBp(machine.conditionBp + scheduledRestorationBp(machine));
  const updated = await tx.machine.update({
    where: { id: machine.id },
    data: {
      conditionBp,
      conditionUpdatedAtGameMs: dueGameMs,
      status: MachineStatus.IDLE,
      repairEndsAtGameMs: null,
    },
    select: MACHINE_SELECT,
  });
  return toRecord(updated);
}

// ---------------------------------------------------------------------------
// Bits the three write paths share
// ---------------------------------------------------------------------------

/** The refusal of a machine that is reserved, being repaired or working. */
function notIdle(machine: MachineRecord): ApiError {
  return new ApiError(ValidationCode.MACHINE_NOT_IDLE, {
    entityId: machine.id,
    entityKind: machine.type,
  });
}

/**
 * Affordability against the settled balance, inside this transaction.
 *
 * The player row is locked by `withPlayerAdvanced`, so the reading cannot be overtaken; the
 * conditional update inside `charge` remains the second, independent defence. Both purchase
 * and repair are discretionary spending, which a negative settled balance blocks; selling is
 * income and goes through `credit`, which is never refused, because it is the only way out
 * of debt (plan section 6.6).
 */
async function requireAffordable(tx: Tx, playerId: PlayerId, price: Money): Promise<void> {
  const settled = toMoney(
    (await tx.player.findUniqueOrThrow({ where: { id: playerId }, select: { balance: true } }))
      .balance,
  );
  if (Money.isNegative(settled)) {
    throw spendingBlockedInDebt(toWireMoney(settled));
  }
  if (Money.compare(settled, price) < 0) {
    throw insufficientFunds(toWireMoney(price), toWireMoney(settled));
  }
}

/**
 * The garage, the player and the ledger, which the two money moving routes both emit.
 *
 * The garage travels because its occupancy changed, and the contract declares
 * `BUILDING_UPSERTED` among the events of both routes: the client keeps the free slot count
 * as a getter over the building, so a purchase it did not see would leave the panel offering
 * a slot that is gone.
 *
 * The row is reloaded through the loader of `farms`, which is the one place that knows the
 * columns of a building, so what is reported is the occupancy the trigger has just written
 * and never a figure this module recomputed.
 */
async function emitGarageAndMoney(
  ctx: MutationContext,
  location: { readonly farmId: string; readonly garageId: string | null },
  entry: LedgerEntry,
  balanceAfter: Money,
): Promise<void> {
  const { tx, reading, lock } = ctx;
  const garageId = location.garageId;
  if (garageId !== null) {
    const row = (await loadBuildings(tx, [location.farmId])).find(
      (building) => building.id === garageId,
    );
    if (row !== undefined) {
      ctx.emit({
        type: GameEventType.BUILDING_UPSERTED,
        payload: { building: toBuildingDto(row) },
      });
    }
  }
  ctx.emit({
    type: GameEventType.PLAYER_UPSERTED,
    payload: { player: await buildPlayerDto(tx, lock.playerId, reading) },
  });
  ctx.emit({
    type: GameEventType.LEDGER_APPENDED,
    payload: { entries: [toLedgerEntryDto(entry)], balance: toWireMoney(balanceAfter) },
  });
}
