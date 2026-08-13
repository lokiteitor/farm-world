// The machine row, its derived readings and the reading side of the module.
//
// Owner: workflow W5-A. Module `machinery`.
//
// This file exists to break a cycle rather than to add a layer: `service.ts` emits frames
// and therefore needs the read model, and `readModel.ts` needs the row and its derived
// figures. Everything both of them depend on lives here, so the dependency graph of the
// module is a chain and not a loop: `record` <- `readModel` <- `service`.
//
// Nothing here writes. The four derived readings are all evaluations of a shared rule and
// never arithmetic of their own, which is what keeps the figure the client greys a button
// with and the figure the server charges the same figure (plan section 8, ADR-0030).

import { toGameMs, toGameMsOrNull, toMoney, type DecimalLike } from '../../lib/dbMap.js';
import { type Db } from '../../lib/tx.js';
import {
  ApiError,
  MACHINE_CATALOGUE,
  MIN_CONDITION_TO_ASSIGN,
  type MachineStatus,
  Money,
  REPAIR_GAME_HOURS_PER_CONDITION_POINT,
  ValidationCode,
  canAssignMachine,
  clampBp,
  gameHours,
  gameHoursToGameMs,
  machineConditionTooLow,
  machineResaleValue,
  notFound,
  notOwned,
  repairCost,
  repairDurationGameHours,
  type Bp,
  type GameMs,
  type MachineDefinition,
  type MachineType,
  type PlayerId,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

/** Polymorphic reference this module writes into the ledger and into the outbox. */
export const MACHINE_REF_TYPE = 'MACHINE';

/**
 * Milliseconds of game time one condition point of repair takes, derived from the shared
 * constant so the balance number lives in `shared/config` and only there (plan section 8).
 *
 * It is the factor of the two exact conversions of `service.ts`: the duration a repair is
 * scheduled with, and the basis points that duration says were bought.
 */
export const REPAIR_MS_PER_CONDITION_POINT: bigint = gameHoursToGameMs(
  REPAIR_GAME_HOURS_PER_CONDITION_POINT,
);

/** A machine, as this module reads it. */
export interface MachineRecord {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly farmId: string;
  readonly garageId: string | null;
  readonly type: MachineType;
  readonly conditionBp: Bp;
  readonly conditionUpdatedAtGameMs: GameMs;
  readonly status: MachineStatus;
  readonly currentTaskId: string | null;
  readonly repairEndsAtGameMs: GameMs | null;
  readonly purchasePrice: Money;
  readonly acquiredGameMs: GameMs;
  readonly disposedGameMs: GameMs | null;
}

/** Columns of a machine row, kept next to the mapper that has to read every one of them. */
export const MACHINE_SELECT = {
  id: true,
  playerId: true,
  farmId: true,
  garageId: true,
  type: true,
  conditionBp: true,
  conditionUpdatedAtGameMs: true,
  status: true,
  currentTaskId: true,
  repairEndsAtGameMs: true,
  purchasePrice: true,
  acquiredGameMs: true,
  disposedGameMs: true,
} as const;

/** The shape `MACHINE_SELECT` produces, stated so the mapper does not depend on Prisma. */
export interface MachineRow {
  readonly id: string;
  readonly playerId: string;
  readonly farmId: string;
  readonly garageId: string | null;
  readonly type: MachineType;
  readonly conditionBp: number;
  readonly conditionUpdatedAtGameMs: bigint;
  readonly status: MachineStatus;
  readonly currentTaskId: string | null;
  readonly repairEndsAtGameMs: bigint | null;
  readonly purchasePrice: DecimalLike;
  readonly acquiredGameMs: bigint;
  readonly disposedGameMs: bigint | null;
}

export function toRecord(row: MachineRow): MachineRecord {
  return {
    id: row.id,
    playerId: row.playerId as PlayerId,
    farmId: row.farmId,
    garageId: row.garageId,
    type: row.type,
    conditionBp: clampBp(row.conditionBp),
    conditionUpdatedAtGameMs: toGameMs(row.conditionUpdatedAtGameMs),
    status: row.status,
    currentTaskId: row.currentTaskId,
    repairEndsAtGameMs: toGameMsOrNull(row.repairEndsAtGameMs),
    purchasePrice: toMoney(row.purchasePrice),
    acquiredGameMs: toGameMs(row.acquiredGameMs),
    disposedGameMs: toGameMsOrNull(row.disposedGameMs),
  };
}

/** The catalogue entry of a machine. Total: the record is keyed by the union. */
export function definitionOf(type: MachineType): MachineDefinition {
  return MACHINE_CATALOGUE[type];
}

// ---------------------------------------------------------------------------
// Derived readings
// ---------------------------------------------------------------------------

/**
 * What a sale returns at the current condition (plan section 6.6).
 *
 * The shared rule and not a second formula: the read model quotes the same function the
 * sale credits, so a retuned resale factor moves the two together instead of leaving the
 * interface quoting a refund the server will not pay.
 */
export function resaleValueOf(machine: MachineRecord): Money {
  return machineResaleValue({
    purchasePrice: machine.purchasePrice,
    conditionBp: machine.conditionBp,
  });
}

/**
 * The cost of taking a machine from one condition to another (GDD section 93).
 *
 * Expressed as the difference of two evaluations of the shared rule rather than as a second
 * formula, so the partial repair the contract admits and the full repair the GDD describes
 * cannot drift apart: `repairCost(c) - repairCost(t)` is `repairCostPerPoint x (t - c) / 100`
 * by construction, and it is exactly `repairCost(c)` when the target is full condition.
 */
export function repairCostBetween(
  conditionBp: Bp,
  targetBp: Bp,
  definition: MachineDefinition,
): Money {
  return Money.sub(repairCost(conditionBp, definition), repairCost(targetBp, definition));
}

/** The duration of that same repair, by the same difference (plan section 2.2). */
export function repairDurationBetween(conditionBp: Bp, targetBp: Bp): bigint {
  return gameHoursToGameMs(
    gameHours(repairDurationGameHours(conditionBp) - repairDurationGameHours(targetBp)),
  );
}

/**
 * The basis points a scheduled repair is going to restore, read back from the row.
 *
 * The inverse of `repairDurationBetween`, and the reason the handler of the due event needs
 * nothing from its payload: the length of the repair is the number of points that were paid
 * for, and `conditionUpdatedAtGameMs` is the instant it started, which cannot move while the
 * machine is in the workshop because wear only applies to hours worked (GDD section 93).
 */
export function scheduledRestorationBp(machine: MachineRecord): number {
  const ends = machine.repairEndsAtGameMs;
  if (ends === null) {
    return 0;
  }
  const durationMs = ends - machine.conditionUpdatedAtGameMs;
  if (durationMs <= 0n) {
    return 0;
  }
  return Math.round((Number(durationMs) * 100) / Number(REPAIR_MS_PER_CONDITION_POINT));
}

/**
 * Whether a machine may be reserved by a task, as the code of the rule it fails or null
 * (GDD section 104, steps 2 and 3).
 *
 * A thin wrapper over the shared rule on purpose: the client calls the very same function
 * to grey the option out, so the reason the panel shows and the reason the server returns
 * are the same value and not two spellings of it.
 */
export function machineAssignmentRefusal(
  machine: MachineRecord,
  minConditionBp: Bp = MIN_CONDITION_TO_ASSIGN,
): ValidationCode | null {
  return canAssignMachine(
    { type: machine.type, conditionBp: machine.conditionBp, status: machine.status },
    minConditionBp,
  );
}

/** Whether the condition is above the floor a task assignment demands (plan section 2.2). */
export function isAssignable(machine: MachineRecord): boolean {
  return machineAssignmentRefusal(machine) === null;
}

/** The refusal above as the error of the contract, with the figures the panel renders. */
export function assignmentError(machine: MachineRecord, minConditionBp: Bp): ApiError {
  const refusal = machineAssignmentRefusal(machine, minConditionBp);
  if (refusal === ValidationCode.MACHINE_CONDITION_TOO_LOW) {
    return machineConditionTooLow(machine.id, machine.conditionBp, minConditionBp);
  }
  return new ApiError(refusal ?? ValidationCode.MACHINE_NOT_IDLE, {
    entityId: machine.id,
    entityKind: machine.type,
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Every live machine of a player, oldest first, which is the order the panel lists. */
export async function loadMachines(db: Db, playerId: PlayerId): Promise<readonly MachineRecord[]> {
  const rows = await db.machine.findMany({
    where: { playerId, disposedGameMs: null },
    orderBy: [{ acquiredGameMs: 'asc' }, { id: 'asc' }],
    select: MACHINE_SELECT,
  });
  return rows.map(toRecord);
}

/** A live machine of a player, or null. Used where absence is not an error. */
export async function findLiveMachine(
  db: Db,
  playerId: PlayerId,
  machineId: string,
): Promise<MachineRecord | null> {
  const row = await db.machine.findUnique({ where: { id: machineId }, select: MACHINE_SELECT });
  if (row === null || row.disposedGameMs !== null || row.playerId !== playerId) {
    return null;
  }
  return toRecord(row);
}

/**
 * A live machine of the player, or the error of the contract that says why not.
 *
 * A machine of another player is a 403 and not a 404, for the reason `farms/service.ts`
 * states: the identifier is not a secret, and hiding the difference would make a bug of the
 * interface indistinguishable from a permission problem.
 */
export async function requireMachine(
  db: Db,
  playerId: PlayerId,
  machineId: string,
): Promise<MachineRecord> {
  const row = await db.machine.findUnique({ where: { id: machineId }, select: MACHINE_SELECT });
  if (row === null || row.disposedGameMs !== null) {
    throw notFound('Machine', machineId);
  }
  if (row.playerId !== playerId) {
    throw notOwned('Machine', machineId);
  }
  return toRecord(row);
}
