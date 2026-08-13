// The task row, its derived readings and the reading side of the module.
//
// Owner: workflow W6-A. Module `tasks`.
//
// A task is the single authoritative link between a worker, a set of machines and a target
// (ADR-0040, plan section 5.2). `Worker.currentTaskId`, `Machine.currentTaskId` and
// `Field.currentTaskId` are reservation columns whose `UNIQUE` and `CHECK` constraints make
// a double booking impossible; they are never the source of truth about what a worker is
// doing, which is this table plus `task_machines`.
//
// Nothing here writes. The file exists to break a cycle rather than to add a layer, exactly
// as `machinery/record.ts` does: `service.ts` emits frames and therefore needs the read
// model, and the read model needs the row. The dependency graph of the module is a chain,
// `record` <- `assignment` <- `service` <- `routes`/`jobs`.

import { toGameMs, toGameMsOrNull } from '../../lib/dbMap.js';
import { type DomainEventDraft } from '../../lib/events.js';
import { type Db } from '../../lib/tx.js';
import {
  GameEventType,
  MachineRole,
  TaskStatus,
  clampBp,
  notFound,
  notOwned,
  toWireGameMs,
  type Bp,
  type CropId,
  type FarmId,
  type FieldId,
  type ForestPlotId,
  type GameMs,
  type MachineId,
  type PlayerId,
  type TaskDto,
  type TaskId,
  type TaskOperation,
  type WorkerId,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

/** Polymorphic reference this module writes into the outbox and into the ledger. */
export const TASK_REF_TYPE = 'TASK';

/** Columns of a task row, next to the mapper that has to read every one of them. */
export const TASK_SELECT = {
  id: true,
  playerId: true,
  workerId: true,
  operation: true,
  status: true,
  targetFieldId: true,
  targetForestPlotId: true,
  destinationFarmId: true,
  cropId: true,
  unitsAtStart: true,
  effectiveWorkSpeedMilli: true,
  reservedStorageUnits: true,
  startGameMs: true,
  scheduledEndGameMs: true,
  endedGameMs: true,
  cancelable: true,
  machines: { select: { machineId: true, role: true } },
} as const;

/** The shape `TASK_SELECT` produces, stated so the mapper does not depend on Prisma. */
export interface TaskRow {
  readonly id: string;
  readonly playerId: string;
  readonly workerId: string;
  readonly operation: TaskOperation;
  readonly status: TaskStatus;
  readonly targetFieldId: string | null;
  readonly targetForestPlotId: string | null;
  readonly destinationFarmId: string | null;
  readonly cropId: CropId | null;
  readonly unitsAtStart: number;
  readonly effectiveWorkSpeedMilli: number;
  readonly reservedStorageUnits: number | null;
  readonly startGameMs: bigint;
  readonly scheduledEndGameMs: bigint;
  readonly endedGameMs: bigint | null;
  readonly cancelable: boolean;
  readonly machines: readonly { readonly machineId: string; readonly role: MachineRole }[];
}

/** A task, as this module reads it. */
export interface TaskRecord {
  readonly id: TaskId;
  readonly playerId: PlayerId;
  readonly workerId: WorkerId;
  readonly operation: TaskOperation;
  readonly status: TaskStatus;
  readonly targetFieldId: FieldId | null;
  readonly targetForestPlotId: ForestPlotId | null;
  readonly destinationFarmId: FarmId | null;
  readonly cropId: CropId | null;
  readonly unitsAtStart: number;
  readonly effectiveWorkSpeedMilli: number;
  readonly reservedStorageUnits: number | null;
  readonly startGameMs: GameMs;
  readonly scheduledEndGameMs: GameMs;
  readonly endedGameMs: GameMs | null;
  readonly cancelable: boolean;
  /** The powered machine first, then its implement, which is the order the contract asks for. */
  readonly machineIds: readonly MachineId[];
}

/**
 * Machines of a task, powered first and then implements, each group by identifier.
 *
 * Ordered here and not in the query because the ordering of a PostgreSQL enum is its
 * declaration order, which is a fact of the migration rather than of the contract: the
 * reply declares "the powered machine first, then its implement", and that has to hold
 * whatever the enum was declared like.
 */
function orderedMachineIds(
  machines: readonly { readonly machineId: string; readonly role: MachineRole }[],
): readonly MachineId[] {
  const rank = (role: MachineRole): number => (role === MachineRole.POWERED ? 0 : 1);
  return [...machines]
    .sort(
      (left, right) =>
        rank(left.role) - rank(right.role) || left.machineId.localeCompare(right.machineId),
    )
    .map((link) => link.machineId as MachineId);
}

export function toTaskRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id as TaskId,
    playerId: row.playerId as PlayerId,
    workerId: row.workerId as WorkerId,
    operation: row.operation,
    status: row.status,
    targetFieldId: row.targetFieldId === null ? null : (row.targetFieldId as FieldId),
    targetForestPlotId:
      row.targetForestPlotId === null ? null : (row.targetForestPlotId as ForestPlotId),
    destinationFarmId: row.destinationFarmId === null ? null : (row.destinationFarmId as FarmId),
    cropId: row.cropId,
    unitsAtStart: row.unitsAtStart,
    effectiveWorkSpeedMilli: row.effectiveWorkSpeedMilli,
    reservedStorageUnits: row.reservedStorageUnits,
    startGameMs: toGameMs(row.startGameMs),
    scheduledEndGameMs: toGameMs(row.scheduledEndGameMs),
    endedGameMs: toGameMsOrNull(row.endedGameMs),
    cancelable: row.cancelable,
    machineIds: orderedMachineIds(row.machines),
  };
}

// ---------------------------------------------------------------------------
// Derived readings
// ---------------------------------------------------------------------------

/**
 * Elapsed fraction of the scheduled duration, in basis points.
 *
 * The clock of the reply and not a stored column: the progress of a task is a projection
 * exactly like the growth of a crop (plan section 6.5, invariant 5), and storing it would
 * be a second truth that a worker outage leaves stale. A finished task is measured up to
 * the instant it really ended, so a cancellation reports the fraction that was worked and
 * not the fraction that was planned (GDD section 106).
 */
export function progressBp(task: TaskRecord, atGameMs: GameMs): Bp {
  const span = task.scheduledEndGameMs - task.startGameMs;
  if (span <= 0n) {
    return clampBp(10_000);
  }
  const end = task.endedGameMs ?? atGameMs;
  const elapsed = (end < atGameMs ? end : atGameMs) - task.startGameMs;
  if (elapsed <= 0n) {
    return clampBp(0);
  }
  return clampBp(Number((elapsed * 10_000n) / span));
}

/** Game hours a task actually worked, which is what the wear of GDD section 93 is prorated over. */
export function workedGameHours(task: TaskRecord, endGameMs: GameMs): number {
  const elapsed = endGameMs - task.startGameMs;
  if (elapsed <= 0n) {
    return 0;
  }
  return Number(elapsed) / 3_600_000;
}

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/** A task as the contract carries it, with its progress projected to an instant. */
export function toTaskDto(task: TaskRecord, atGameMs: GameMs): TaskDto {
  return {
    id: task.id,
    workerId: task.workerId,
    machineIds: [...task.machineIds],
    operation: task.operation,
    status: task.status,
    targetFieldId: task.targetFieldId,
    targetForestPlotId: task.targetForestPlotId,
    destinationFarmId: task.destinationFarmId,
    cropId: task.cropId,
    unitsAtStart: task.unitsAtStart,
    effectiveWorkSpeedMilli: task.effectiveWorkSpeedMilli,
    reservedStorageUnits: task.reservedStorageUnits,
    startGameMs: toWireGameMs(task.startGameMs),
    scheduledEndGameMs: toWireGameMs(task.scheduledEndGameMs),
    endedGameMs: task.endedGameMs === null ? null : toWireGameMs(task.endedGameMs),
    cancelable: task.cancelable,
    progressBp: progressBp(task, atGameMs),
  };
}

/**
 * The frame every write of this module emits for the task it touched.
 *
 * One tag for the start, the completion and the cancellation, which is what
 * `shared/ws/events.ts` prescribes: the three differ only in `status` and in whether
 * `endedGameMs` is set, and three tags would force the reducer to rebuild the entity from
 * three partial shapes.
 */
export function taskUpsertedFrame(task: TaskRecord, atGameMs: GameMs): DomainEventDraft {
  return { type: GameEventType.TASK_UPSERTED, payload: { task: toTaskDto(task, atGameMs) } };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A task of a player, or null. Used where absence is not an error, such as a job handler. */
export async function findTask(db: Db, playerId: PlayerId, id: string): Promise<TaskRecord | null> {
  const row = await db.task.findUnique({ where: { id }, select: TASK_SELECT });
  if (row === null || row.playerId !== playerId) {
    return null;
  }
  return toTaskRecord(row);
}

/**
 * A task of the player, or the error of the contract that says why not.
 *
 * A task of another player is a 403 and not a 404, for the reason `farms/service.ts`
 * states: the identifier is not a secret, and hiding the difference would make a bug of the
 * interface indistinguishable from a permission problem.
 */
export async function requireTask(db: Db, playerId: PlayerId, id: string): Promise<TaskRecord> {
  const row = await db.task.findUnique({ where: { id }, select: TASK_SELECT });
  if (row === null) {
    throw notFound('Task', id);
  }
  if (row.playerId !== playerId) {
    throw notOwned('Task', id);
  }
  return toTaskRecord(row);
}

/** Every task of a player that is still running, oldest first. */
export async function loadRunningTasks(db: Db, playerId: PlayerId): Promise<readonly TaskRecord[]> {
  const rows = await db.task.findMany({
    where: { playerId, status: TaskStatus.IN_PROGRESS },
    orderBy: [{ startGameMs: 'asc' }, { id: 'asc' }],
    select: TASK_SELECT,
  });
  return rows.map(toTaskRecord);
}

/** One page of the listing. The cursor is the identifier of the last row of the page. */
export interface TaskPage {
  readonly tasks: readonly TaskRecord[];
  readonly nextCursor: string | null;
}

/**
 * Tasks of a player, newest first, paged by identifier.
 *
 * Newest first because the panel of GDD section 111 lists what is running now; the cursor
 * is the identifier and not the instant, because two tasks assigned in the same
 * transaction share an instant and a cursor that is not unique skips rows.
 */
export async function loadTaskPage(
  db: Db,
  playerId: PlayerId,
  query: {
    readonly status?: TaskStatus | undefined;
    readonly limit: number;
    readonly cursor?: string | undefined;
  },
): Promise<TaskPage> {
  const rows = await db.task.findMany({
    where: {
      playerId,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.cursor === undefined ? {} : { id: { lt: query.cursor } }),
    },
    orderBy: { id: 'desc' },
    take: query.limit + 1,
    select: TASK_SELECT,
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    tasks: page.map(toTaskRecord),
    nextCursor: rows.length > query.limit && last !== undefined ? last.id : null,
  };
}
