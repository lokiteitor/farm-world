// The rows of the forestry area and their derived readings.
//
// Owner: workflow W6-C. Module `forestry`.
//
// This file exists to break a cycle rather than to add a layer, exactly as `record.ts` of
// `modules/machinery` does: `service.ts` emits frames and therefore needs the read model, and
// `readModel.ts` needs the rows and their derived figures. Everything both depend on lives
// here, so the dependency graph of the module is a chain and not a loop:
// `generator` <- `record` <- `readModel` <- `service` <- `tasks` <- `jobs`/`routes`.
//
// Nothing here writes, and nothing here computes a stage or a volume by hand: every derived
// reading of a tree is an evaluation of `shared/rules/forestry.ts`, which is the module the
// client runs too. A tree that the panel draws as mature and a tree the server fells as mature
// have to be the same tree (plan section 8, ADR-0030).

import { toGameMs, toGameMsOrNull } from '../../lib/dbMap.js';
import { type Db } from '../../lib/tx.js';
import {
  ApiError,
  TaskStatus,
  TreeStatus,
  ValidationCode,
  notFound,
  notOwned,
  type CellCoord,
  type GameMs,
  type PlayerId,
  type TaskOperation,
  type TreeSpecies,
  type TreeView,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// Polymorphic reference types
// ---------------------------------------------------------------------------

/** Reference this module writes into the outbox for a plot level event. */
export const FOREST_PLOT_REF_TYPE = 'FOREST_PLOT';

/**
 * Reference of a `TASK_COMPLETE` event.
 *
 * Declared here and not imported: `modules/tasks` is a sibling of this phase and the ESLint
 * zones forbid the import (plan section 11, rule 4). The value is the convention every other
 * module already follows — `FIELD` in `modules/fields`, `MACHINE` in `modules/machinery` — so
 * the two writers agree by naming the entity and not by sharing a constant.
 */
export const TASK_REF_TYPE = 'TASK';

// ---------------------------------------------------------------------------
// Forest plot
// ---------------------------------------------------------------------------

export interface ForestPlotRecord {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly farmId: string | null;
  readonly name: string;
  readonly cellCount: number;
  readonly currentTaskId: string | null;
  readonly createdAtGameMs: GameMs;
  readonly disposedGameMs: GameMs | null;
}

export const FOREST_PLOT_SELECT = {
  id: true,
  playerId: true,
  farmId: true,
  name: true,
  cellCount: true,
  currentTaskId: true,
  createdAtGameMs: true,
  disposedGameMs: true,
} as const;

interface ForestPlotRow {
  readonly id: string;
  readonly playerId: string;
  readonly farmId: string | null;
  readonly name: string;
  readonly cellCount: number;
  readonly currentTaskId: string | null;
  readonly createdAtGameMs: bigint;
  readonly disposedGameMs: bigint | null;
}

export function toForestPlotRecord(row: ForestPlotRow): ForestPlotRecord {
  return {
    id: row.id,
    playerId: row.playerId as PlayerId,
    farmId: row.farmId,
    name: row.name,
    cellCount: row.cellCount,
    currentTaskId: row.currentTaskId,
    createdAtGameMs: toGameMs(row.createdAtGameMs),
    disposedGameMs: toGameMsOrNull(row.disposedGameMs),
  };
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

/**
 * A tree, as this module reads it.
 *
 * The four fields GDD section 130 lists as columns — `growthStage`, `age`, `woodVolume` and
 * the derived part of `status` — are absent on purpose. They are derived from
 * `plantedAtGameMs`, the species and the clock, which is the resolution of GDD section 130
 * against GDD section 140 (plan section 2.2, ADR-0030).
 */
export interface TreeRecord extends CellCoord {
  readonly id: string;
  readonly forestPlotId: string;
  readonly playerId: PlayerId;
  readonly worldId: string;
  readonly species: TreeSpecies;
  readonly plantedAtGameMs: GameMs;
  readonly status: TreeStatus;
  readonly felledAtGameMs: GameMs | null;
  readonly naturallyGenerated: boolean;
}

export const TREE_SELECT = {
  id: true,
  forestPlotId: true,
  playerId: true,
  worldId: true,
  cellX: true,
  cellY: true,
  species: true,
  plantedAtGameMs: true,
  status: true,
  felledAtGameMs: true,
  naturallyGenerated: true,
} as const;

interface TreeRow {
  readonly id: string;
  readonly forestPlotId: string;
  readonly playerId: string;
  readonly worldId: string;
  readonly cellX: number;
  readonly cellY: number;
  readonly species: TreeSpecies;
  readonly plantedAtGameMs: bigint;
  readonly status: TreeStatus;
  readonly felledAtGameMs: bigint | null;
  readonly naturallyGenerated: boolean;
}

export function toTreeRecord(row: TreeRow): TreeRecord {
  return {
    id: row.id,
    forestPlotId: row.forestPlotId,
    playerId: row.playerId as PlayerId,
    worldId: row.worldId,
    cellX: row.cellX,
    cellY: row.cellY,
    species: row.species,
    plantedAtGameMs: toGameMs(row.plantedAtGameMs),
    status: row.status,
    felledAtGameMs: toGameMsOrNull(row.felledAtGameMs),
    naturallyGenerated: row.naturallyGenerated,
  };
}

/** The part of a tree the pure rules of `shared/rules/forestry.ts` take. */
export function treeView(tree: TreeRecord): TreeView {
  return {
    species: tree.species,
    plantedAtGameMs: tree.plantedAtGameMs,
    status: tree.status,
  };
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

/**
 * A task, as this module reads and writes it.
 *
 * `modules/tasks` of workflow W6-A owns the engine and its four agricultural operations; this
 * module owns the three forestry ones, which the contract routes through the `forestry` area
 * (`shared/api/schemas/tasks.ts`). The two write the same table and never import each other,
 * which is the price of rule 4 of plan section 11 and the reason the shape is declared twice.
 */
export interface TaskRecord {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly workerId: string;
  readonly operation: TaskOperation;
  readonly status: TaskStatus;
  readonly targetFieldId: string | null;
  readonly targetForestPlotId: string | null;
  readonly destinationFarmId: string | null;
  readonly unitsAtStart: number;
  readonly effectiveWorkSpeedMilli: number;
  readonly reservedStorageUnits: number | null;
  readonly startGameMs: GameMs;
  readonly scheduledEndGameMs: GameMs;
  readonly endedGameMs: GameMs | null;
  readonly cancelable: boolean;
  readonly machineIds: readonly string[];
}

export const TASK_SELECT = {
  id: true,
  playerId: true,
  workerId: true,
  operation: true,
  status: true,
  targetFieldId: true,
  targetForestPlotId: true,
  destinationFarmId: true,
  unitsAtStart: true,
  effectiveWorkSpeedMilli: true,
  reservedStorageUnits: true,
  startGameMs: true,
  scheduledEndGameMs: true,
  endedGameMs: true,
  cancelable: true,
  machines: { select: { machineId: true, role: true }, orderBy: { role: 'asc' } },
} as const;

interface TaskRow {
  readonly id: string;
  readonly playerId: string;
  readonly workerId: string;
  readonly operation: TaskOperation;
  readonly status: TaskStatus;
  readonly targetFieldId: string | null;
  readonly targetForestPlotId: string | null;
  readonly destinationFarmId: string | null;
  readonly unitsAtStart: number;
  readonly effectiveWorkSpeedMilli: number;
  readonly reservedStorageUnits: number | null;
  readonly startGameMs: bigint;
  readonly scheduledEndGameMs: bigint;
  readonly endedGameMs: bigint | null;
  readonly cancelable: boolean;
  readonly machines: readonly { readonly machineId: string }[];
}

export function toTaskRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    playerId: row.playerId as PlayerId,
    workerId: row.workerId,
    operation: row.operation,
    status: row.status,
    targetFieldId: row.targetFieldId,
    targetForestPlotId: row.targetForestPlotId,
    destinationFarmId: row.destinationFarmId,
    unitsAtStart: row.unitsAtStart,
    effectiveWorkSpeedMilli: row.effectiveWorkSpeedMilli,
    reservedStorageUnits: row.reservedStorageUnits,
    startGameMs: toGameMs(row.startGameMs),
    scheduledEndGameMs: toGameMs(row.scheduledEndGameMs),
    endedGameMs: toGameMsOrNull(row.endedGameMs),
    cancelable: row.cancelable,
    machineIds: row.machines.map((machine) => machine.machineId),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The live plots of a player, oldest first. */
export async function loadPlayerPlots(
  db: Db,
  playerId: PlayerId,
): Promise<readonly ForestPlotRecord[]> {
  const rows = await db.forestPlot.findMany({
    where: { playerId, disposedGameMs: null },
    orderBy: [{ createdAtGameMs: 'asc' }, { id: 'asc' }],
    select: FOREST_PLOT_SELECT,
  });
  return rows.map(toForestPlotRecord);
}

/** A live plot of the player, or null. The form the scheduled event handler needs. */
export async function findLivePlot(
  db: Db,
  playerId: PlayerId,
  forestPlotId: string,
): Promise<ForestPlotRecord | null> {
  const row = await db.forestPlot.findUnique({
    where: { id: forestPlotId },
    select: FOREST_PLOT_SELECT,
  });
  if (row === null || row.disposedGameMs !== null || row.playerId !== playerId) {
    return null;
  }
  return toForestPlotRecord(row);
}

/** A live plot of the player, or the refusal of the contract. */
export async function requirePlot(
  db: Db,
  playerId: PlayerId,
  forestPlotId: string,
): Promise<ForestPlotRecord> {
  const row = await db.forestPlot.findUnique({
    where: { id: forestPlotId },
    select: FOREST_PLOT_SELECT,
  });
  if (row === null || row.disposedGameMs !== null) {
    throw notFound('ForestPlot', forestPlotId);
  }
  if (row.playerId !== playerId) {
    throw notOwned('ForestPlot', forestPlotId);
  }
  return toForestPlotRecord(row);
}

/**
 * Refuses a plot that a task is already working on (GDD section 104, check five).
 *
 * Derived and not declared. `ForestPlot.currentTaskId` is a reservation column, exactly like
 * `Machine.currentTaskId`, and the authority is the task row: a plot is busy when a task of its
 * own is `IN_PROGRESS` (ADR-0040). Reading the task rather than trusting the pointer is what
 * keeps a plot usable if a cancellation ever leaves the column behind, which is the failure
 * mode the two cross pointers of GDD sections 98 and 101 were rejected for.
 */
export async function requireIdlePlot(db: Db, plot: ForestPlotRecord): Promise<void> {
  const active = await db.task.findFirst({
    where: { targetForestPlotId: plot.id, status: TaskStatus.IN_PROGRESS },
    select: { id: true },
  });
  if (active !== null) {
    throw new ApiError(ValidationCode.FIELD_HAS_ACTIVE_TASK, {
      entityId: plot.id,
      entityKind: 'ForestPlot',
      taskId: active.id,
    });
  }
}

/** The cells of a plot, in row major order. The geometry lives on the cell (plan section 5.2). */
export async function plotCells(db: Db, forestPlotId: string): Promise<readonly CellCoord[]> {
  const rows = await db.worldCell.findMany({
    where: { forestPlotId },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: { cellX: true, cellY: true },
  });
  return rows.map((row) => ({ cellX: row.cellX, cellY: row.cellY }));
}

/** The standing trees of a plot, in row major order of their cell. */
export async function standingTrees(db: Db, forestPlotId: string): Promise<readonly TreeRecord[]> {
  const rows = await db.tree.findMany({
    where: { forestPlotId, status: TreeStatus.STANDING },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: TREE_SELECT,
  });
  return rows.map(toTreeRecord);
}

/** A page of trees of a plot, filtered by status, for the detail route of the contract. */
export async function pageTrees(
  db: Db,
  forestPlotId: string,
  input: {
    readonly status?: TreeStatus | undefined;
    readonly limit: number;
    readonly afterId?: string | undefined;
  },
): Promise<readonly TreeRecord[]> {
  const rows = await db.tree.findMany({
    where: {
      forestPlotId,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.afterId === undefined ? {} : { id: { gt: input.afterId } }),
    },
    orderBy: { id: 'asc' },
    take: input.limit,
    select: TREE_SELECT,
  });
  return rows.map(toTreeRecord);
}

/** A task of the player, or null. Used by the completion handler, which must never throw. */
export async function findTask(db: Db, taskId: string): Promise<TaskRecord | null> {
  const row = await db.task.findUnique({ where: { id: taskId }, select: TASK_SELECT });
  return row === null ? null : toTaskRecord(row);
}
