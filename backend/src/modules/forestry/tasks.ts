// The three forestry operations as tasks: felling, replanting and clearing.
//
// Owner: workflow W6-C. Module `forestry`.
//
// WHY THIS FILE EXISTS AT ALL, since `modules/tasks` is the task engine. The contract routes
// the three forestry operations through the `forestry` area and not through `POST /api/tasks`
// (`shared/api/schemas/tasks.ts`, "Division of the routes"), and `tasks` and `forestry` are
// siblings of the same workflow, which rule 4 of plan section 11 forbids from importing each
// other. So the assignment and the completion of these three live here, and what is written
// twice is the sequence of checks, never the truth: the truth is the `tasks` row, exactly as
// ADR-0040 fixed it, and every piece that belongs to another module is asked of that module —
// `requireAssignableMachines` and `applyMachineWearOverInterval` of `modules/machinery`,
// `requireIdleWorker`, `requireWorkerOfFarm`, `reserveWorkerForTask` and `applyTaskCompletion`
// of `modules/workers`, and `reserveStorage` and `depositStorage` of `modules/farms`.
//
// THE ORDER OF THE CHECKS is the six of GDD section 104 and it is not negotiable, because the
// server answers only the first one that fails and the panel has to reproduce the same order to
// be useful (ADR-0048). For all three operations:
//
//   1. The target: the plot exists, belongs to the player and has no task in flight; and for a
//      clearing, the cells pass the shared selection rules.
//   2. The worker: exists, is idle (GDD section 104) and belongs to the farm of the operation
//      (GDD section 108).
//   3. The machinery: assignable, above the condition floor, and compatible with the operation
//      according to the table of GDD section 90. This is where agricultural machinery is
//      refused for a felling: the catalogue is separate and GDD section 134 is explicit that a
//      tractor is not a forestry harvester.
//   4. The farm of the machinery, which must be the farm of the worker. The trigger
//      `task_machines_farm_guard` of the initial migration is the safety net; this is the
//      readable refusal.
//   5. The work itself: there has to be something to do — fellable trees, empty cells to
//      replant, felled ground to clear.
//   6. The storage, for a felling only (GDD sections 83, 97 and 136): the capacity is reserved
//      at assignment so an overflow is an actionable rejection and not a silent loss.
//
// Only then are the reservations written, each one a conditional update whose row count is the
// decision (ADR-0018), so a double submission loses the race instead of creating two tasks.
//
// HOW A BATCH REMEMBERS ITS AREA. GDD section 132 defines felling in two steps,
// `MARK_FOR_HARVEST(treeId)` and then `FELL(treeId)`, and the MVP simplifies the interaction to
// an area while keeping the per tree data model ("solo se simplifica la interaccion"). That is
// exactly what is needed here: the assignment marks the trees of the selected area with
// `MARKED_FOR_HARVEST`, and the completion fells the marked ones three hundred game hours
// later. The alternative would be a geometry on the task row, and `tasks` has no column for
// one; the mark is the model the GDD already wrote.
//
// A clearing has no such mark available, because a cleared cell carries no tree by definition.
// Its area is therefore re-derived at completion from its target plot, capped at the unit count
// the task recorded, which is exact whenever the selection covered the felled part of the plot
// and is the documented limitation otherwise (ADR-0050).

import { type MutationContext, type ScheduledEventContext } from '../../lib/advancePlayer.js';
import { type DomainEventDraft } from '../../lib/events.js';
import { type ClockReading } from '../../lib/gameClock.js';
import { scheduledEventDedupeKey } from '../../lib/ids.js';
import { type CancelledTaskView } from '../../lib/moduleSeams.js';
import { type Outbox } from '../../lib/outbox.js';
import { scheduleEvent } from '../../lib/scheduler.js';
import { type Db, type Tx } from '../../lib/tx.js';
import {
  ApiError,
  MACHINE_CATALOGUE,
  MachineRole,
  MachineStatus,
  OPERATION_REQUIREMENTS,
  ScheduledEventKind,
  SelectionPurpose,
  StorageResource,
  TaskOperation,
  TaskStatus,
  TreeStatus,
  ValidationCode,
  addGameMs,
  batchWoodVolume,
  cellKey,
  estimateTaskDuration,
  explainIncompatibility,
  gameHoursToGameMs,
  isFellable,
  validationFailed,
  type CellCoord,
  type GameMs,
  type MachineType,
  type PlayerId,
  type TaskOperation as TaskOperationType,
  type World,
} from '../../shared/index.js';
import { toInventoryFarm } from '../economy/readModel.js';
import { toFarmDto } from '../farms/readModel.js';
import {
  depositStorage,
  loadBuildings,
  requireFarm,
  reserveStorage,
  storageCapacityError,
  storageUsageOf,
  type FarmRow,
} from '../farms/service.js';
import { machineUpsertedFrame } from '../machinery/readModel.js';
import {
  MACHINE_SELECT,
  toRecord as toMachineRecord,
  type MachineRecord,
} from '../machinery/record.js';
import { applyMachineWearOverInterval, requireAssignableMachines } from '../machinery/service.js';
import {
  applyTaskCompletion,
  requireIdleWorker,
  requireWorker,
  requireWorkerOfFarm,
  reserveWorkerForTask,
  workerUpsertedFrame,
  type WorkerRecord,
} from '../workers/service.js';
import { bumpChunkVersions, chunksOfCells } from '../world/service.js';
import {
  forestPlotRemovedFrame,
  forestPlotUpsertedFrame,
  taskUpsertedFrame,
  treesUpsertedFrame,
} from './readModel.js';
import {
  FOREST_PLOT_SELECT,
  TASK_REF_TYPE,
  TASK_SELECT,
  TREE_SELECT,
  plotCells,
  requireIdlePlot,
  requirePlot,
  standingTrees,
  toForestPlotRecord,
  toTaskRecord,
  toTreeRecord,
  treeView,
  type ForestPlotRecord,
  type TaskRecord,
  type TreeRecord,
} from './record.js';
import {
  applyClearing,
  chunkFrames,
  dedupeCells,
  insertTrees,
  refreshPlotCellCount,
  requireValidForestSelection,
  syncMilestoneSchedule,
} from './service.js';

// ---------------------------------------------------------------------------
// The three operations this module owns
// ---------------------------------------------------------------------------

/** The operations whose lifecycle lives in this module (GDD sections 10, 132 and 137). */
export const FORESTRY_OPERATIONS: readonly TaskOperationType[] = [
  TaskOperation.FELL,
  TaskOperation.REPLANT,
  TaskOperation.CLEAR_LAND,
];

export function isForestryOperation(operation: TaskOperationType): boolean {
  return FORESTRY_OPERATIONS.includes(operation);
}

/** Statuses of a tree that still occupies its cell (GDD section 130). */
const LIVE_TREE_STATUSES = [TreeStatus.STANDING, TreeStatus.MARKED_FOR_HARVEST] as const;

// ---------------------------------------------------------------------------
// Machinery of an assignment
// ---------------------------------------------------------------------------

interface ResolvedMachinery {
  readonly machines: readonly MachineRecord[];
  /** The machine that sets the pace: the implement when there is one (GDD section 91). */
  readonly pacing: MachineRecord;
}

/**
 * Loads the machines of an assignment and refuses every combination GDD section 90 rejects.
 *
 * The verdict is `explainIncompatibility` of `shared/rules/machinery.ts`, the same function the
 * panel greys its button with, so a tractor offered for a felling produces the same code on both
 * sides: the powered machine of `FELL` is `HARVESTER_FORESTRY`, so a tractor is reported as
 * `POWERED_MACHINE_REQUIRED` and, being an unused extra, also as `MACHINE_TYPE_NOT_COMPATIBLE`.
 * The forwarder of GDD section 134 is checked against the whole holding, because in the MVP it
 * is an ownership requirement and not a reserved machine (plan section 2.2).
 */
async function resolveMachinery(
  db: Db,
  playerId: PlayerId,
  operation: TaskOperationType,
  machineIds: readonly string[],
  farmId: string,
): Promise<ResolvedMachinery> {
  const machines = await requireAssignableMachines(db, playerId, machineIds);
  for (const machine of machines) {
    if (machine.farmId !== farmId) {
      throw new ApiError(ValidationCode.MACHINE_WRONG_FARM, {
        entityId: machine.id,
        expected: farmId,
        actual: machine.farmId,
      });
    }
  }
  const owned = await db.machine.findMany({
    where: { playerId, disposedGameMs: null },
    select: { type: true },
  });
  // `machineIds` arrives in the order of the request, the powered machine first and the
  // implement second, which is what lets the table of GDD section 90 be read by role and not
  // as a bag of types: a clearing that named the plough as the powered machine and the tractor
  // as the implement offers the same two types and the wrong row of the table.
  const typeOf = (id: string | undefined): MachineType | null =>
    id === undefined ? null : (machines.find((machine) => machine.id === id)?.type ?? null);
  const codes = explainIncompatibility({
    operation,
    offeredMachineTypes: machines.map((machine) => machine.type),
    ownedMachineTypes: owned.map((row) => row.type),
    poweredMachineType: typeOf(machineIds[0]),
    implementMachineType: typeOf(machineIds[1]),
  });
  const first = codes[0];
  if (first !== undefined) {
    throw new ApiError(first, { operation, machineIds: [...machineIds] });
  }

  const requirement = OPERATION_REQUIREMENTS[operation];
  const pacingType = requirement.requiredImplement ?? requirement.poweredMachine;
  const pacing = machines.find((machine) => machine.type === pacingType) ?? machines[0];
  if (pacing === undefined) {
    // Unreachable: `explainIncompatibility` already demanded the powered machine.
    throw new ApiError(ValidationCode.POWERED_MACHINE_REQUIRED, { operation });
  }
  return { machines, pacing };
}

/** Machine records by identifier, read through the module that owns their shape. */
async function loadMachineRecords(
  db: Db,
  ids: readonly string[],
): Promise<readonly MachineRecord[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db.machine.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { id: 'asc' },
    select: MACHINE_SELECT,
  });
  return rows.map((row) => toMachineRecord(row));
}

/**
 * Reserves the machines of a task, as a conditional update whose row count is the decision.
 *
 * `modules/machinery` publishes the reading half of this rule, `requireAssignableMachines`, and
 * not the writing half, because the writer is the task engine (ADR-0040). The machines are taken
 * in ascending order of identifier, which is the canonical lock order of plan section 6.3 and
 * what rules out a deadlock between two assignments that share a machine.
 */
async function reserveMachines(
  tx: Tx,
  machines: readonly MachineRecord[],
  taskId: string,
): Promise<void> {
  const ordered = [...machines].sort((left, right) => (left.id < right.id ? -1 : 1));
  for (const machine of ordered) {
    const updated = await tx.machine.updateMany({
      where: {
        id: machine.id,
        status: MachineStatus.IDLE,
        currentTaskId: null,
        disposedGameMs: null,
      },
      data: { status: MachineStatus.WORKING, currentTaskId: taskId },
    });
    if (updated.count !== 1) {
      throw new ApiError(ValidationCode.MACHINE_NOT_IDLE, { entityId: machine.id });
    }
  }
}

/** Releases the machines of a finished task and reads them back for the frames. */
async function releaseMachines(
  tx: Tx,
  machineIds: readonly string[],
  taskId: string,
): Promise<readonly MachineRecord[]> {
  for (const machineId of [...machineIds].sort()) {
    await tx.machine.updateMany({
      where: { id: machineId, currentTaskId: taskId },
      data: { status: MachineStatus.IDLE, currentTaskId: null },
    });
  }
  return loadMachineRecords(tx, machineIds);
}

// ---------------------------------------------------------------------------
// The assignment
// ---------------------------------------------------------------------------

export interface ForestryAssignment {
  readonly task: TaskRecord;
  readonly machines: readonly MachineRecord[];
  readonly worker: WorkerRecord;
  readonly plot: ForestPlotRecord | null;
}

interface AssignmentPlan {
  readonly operation: TaskOperationType;
  readonly units: number;
  readonly worker: WorkerRecord;
  readonly machinery: ResolvedMachinery;
  readonly targetForestPlotId: string | null;
  readonly destinationFarmId: string | null;
  readonly reservedStorageUnits: number | null;
}

/**
 * Writes the task row, its machines and its reservations, and schedules its completion.
 *
 * The duration is `estimateTaskDuration` of `shared/rules/duration.ts`, which is the formula of
 * GDD section 91 and, for a felling, of GDD section 135: the unit count over the effective work
 * speed, where the speed is the base speed of the operation times the condition factor of the
 * pacing machine times the skill factor of the worker. It is fixed once, here, and the row keeps
 * the effective speed as audit, because GDD section 89 warns that the unit of `workSpeed` will be
 * recalculated (plan section 5.2).
 */
async function writeTask(
  context: MutationContext,
  playerId: PlayerId,
  plan: AssignmentPlan,
): Promise<{
  readonly task: TaskRecord;
  readonly worker: WorkerRecord;
  readonly machines: readonly MachineRecord[];
}> {
  const estimate = estimateTaskDuration({
    operation: plan.operation,
    units: plan.units,
    conditionBp: plan.machinery.pacing.conditionBp,
    skillBp: plan.worker.skillBp,
  });
  const startGameMs = context.reading.gameNow;
  const scheduledEndGameMs = addGameMs(startGameMs, gameHoursToGameMs(estimate.durationGameHours));

  const row = await context.tx.task.create({
    data: {
      playerId,
      workerId: plan.worker.id,
      operation: plan.operation,
      status: TaskStatus.IN_PROGRESS,
      targetForestPlotId: plan.targetForestPlotId,
      destinationFarmId: plan.destinationFarmId,
      unitsAtStart: plan.units,
      effectiveWorkSpeedMilli: estimate.effectiveWorkSpeedMilli,
      reservedStorageUnits: plan.reservedStorageUnits,
      startGameMs,
      scheduledEndGameMs,
      cancelable: true,
      machines: {
        create: plan.machinery.machines.map((machine) => ({
          machineId: machine.id,
          role:
            MACHINE_CATALOGUE[machine.type].role === MachineRole.POWERED
              ? MachineRole.POWERED
              : MachineRole.IMPLEMENT,
        })),
      },
    },
    select: TASK_SELECT,
  });
  const task = toTaskRecord(row);

  if (!(await reserveWorkerForTask(context.tx, plan.worker.id, task.id))) {
    throw new ApiError(ValidationCode.WORKER_NOT_IDLE, { entityId: plan.worker.id });
  }
  await reserveMachines(context.tx, plan.machinery.machines, task.id);
  if (plan.targetForestPlotId !== null) {
    await context.tx.forestPlot.update({
      where: { id: plan.targetForestPlotId },
      data: { currentTaskId: task.id },
    });
  }
  await scheduleTaskCompletion(context.tx, context.outbox, context.reading, playerId, task);
  // Read back after the reservations, so the frames report the worker as working and the
  // machinery as reserved rather than the state they were in a statement earlier.
  return {
    task,
    worker: await requireWorker(context.tx, playerId, plan.worker.id),
    machines: await loadMachineRecords(
      context.tx,
      plan.machinery.machines.map((machine) => machine.id),
    ),
  };
}

/** Schedules the `TASK_COMPLETE` event of a task. One pending row per task, by dedupe key. */
async function scheduleTaskCompletion(
  tx: Tx,
  outbox: Outbox,
  reading: ClockReading,
  playerId: PlayerId,
  task: TaskRecord,
): Promise<void> {
  await scheduleEvent(tx, outbox, reading, {
    playerId,
    kind: ScheduledEventKind.TASK_COMPLETE,
    dueGameMs: task.scheduledEndGameMs,
    refType: TASK_REF_TYPE,
    refId: task.id,
    dedupeKey: scheduledEventDedupeKey(ScheduledEventKind.TASK_COMPLETE, task.id),
  });
}

/** The worker of an assignment, checked in the order of GDD section 104. */
async function resolveWorker(
  db: Db,
  playerId: PlayerId,
  workerId: string,
  farmId: string | null,
): Promise<WorkerRecord> {
  const worker = await requireWorker(db, playerId, workerId);
  requireIdleWorker(worker);
  if (farmId !== null) {
    requireWorkerOfFarm(worker, farmId);
  }
  return worker;
}

/** The live trees of a plot, restricted to an area when the request named one. */
async function liveTreesOfArea(
  db: Db,
  forestPlotId: string,
  area: readonly CellCoord[] | null,
): Promise<readonly TreeRecord[]> {
  const rows = await db.tree.findMany({
    where: { forestPlotId, status: { in: [...LIVE_TREE_STATUSES] } },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: TREE_SELECT,
  });
  const trees = rows.map(toTreeRecord);
  if (area === null) {
    return trees;
  }
  const wanted = new Set(area.map((cell) => cellKey(cell.cellX, cell.cellY)));
  return trees.filter((tree) => wanted.has(cellKey(tree.cellX, tree.cellY)));
}

/** The cells of a plot that carry no live tree, in row major order. */
async function emptyCellsOfPlot(db: Db, plot: ForestPlotRecord): Promise<readonly CellCoord[]> {
  const cells = await plotCells(db, plot.id);
  const occupied = new Set(
    (
      await db.tree.findMany({
        where: { forestPlotId: plot.id, status: { in: [...LIVE_TREE_STATUSES] } },
        select: { cellX: true, cellY: true },
      })
    ).map((row) => cellKey(row.cellX, row.cellY)),
  );
  return cells.filter((cell) => !occupied.has(cellKey(cell.cellX, cell.cellY)));
}

// ---------------------------------------------------------------------------
// FELL (GDD sections 132 and 135)
// ---------------------------------------------------------------------------

export interface FellInput {
  readonly workerId: string;
  readonly poweredMachineId: string;
  readonly destinationFarmId: string;
  readonly cells?: readonly CellCoord[] | undefined;
}

/**
 * Schedules a batch felling over a plot or a sub area of it (GDD section 132, option B).
 *
 * `cells` restricts the batch; omitted means every live tree of the plot. The volume reserved in
 * the store is the volume at the instant of the assignment; the trees keep growing while the
 * harvester works, so the completion recomputes it and the store bounds what it accepts. The
 * reservation is what turns a full store into a rejection the player can act on, and the bounded
 * deposit is what stops the completion job from ever violating a constraint (plan section 5.4).
 */
export async function assignFellTask(
  context: MutationContext,
  playerId: PlayerId,
  forestPlotId: string,
  input: FellInput,
): Promise<ForestryAssignment> {
  const plot = await requirePlot(context.tx, playerId, forestPlotId);
  await requireIdlePlot(context.tx, plot);

  const farm = await requireFarm(context.tx, playerId, input.destinationFarmId);
  const worker = await resolveWorker(context.tx, playerId, input.workerId, farm.id);
  const machinery = await resolveMachinery(
    context.tx,
    playerId,
    TaskOperation.FELL,
    [input.poweredMachineId],
    farm.id,
  );

  const area = input.cells === undefined ? null : dedupeCells(input.cells);
  const trees = await liveTreesOfArea(context.tx, plot.id, area);
  const batch = batchWoodVolume(trees.map(treeView), context.reading.gameNow);
  if (batch.fellableCount === 0) {
    throw new ApiError(ValidationCode.NO_FELLABLE_TREES, {
      entityId: plot.id,
      treeCount: batch.treeCount,
      fellableCount: batch.fellableCount,
    });
  }

  const reservation = await reserveStorage(
    context.tx,
    farm.id,
    StorageResource.WOOD_M3,
    batch.volumeDm3,
  );
  if (!reservation.ok) {
    throw storageCapacityError(StorageResource.WOOD_M3, reservation.usage, batch.volumeDm3);
  }

  const written = await writeTask(context, playerId, {
    operation: TaskOperation.FELL,
    // GDD section 135: the divisor is the count of trees of the area that are not already
    // felled, saplings included, because the harvester still has to reach and pass every one.
    units: batch.treeCount,
    worker,
    machinery,
    targetForestPlotId: plot.id,
    destinationFarmId: farm.id,
    reservedStorageUnits: batch.volumeDm3,
  });

  // Only what GDD section 131 admits felling. A sapling is in the area, so it is counted in
  // `units` above and costs machine time, but it is not marked and therefore not felled: it has
  // no commercial value and the section says outright that it may not be felled. Marking it
  // would destroy it for nothing, and whether it paid or not would depend on how long the
  // felling happened to take, which is the tree crossing a stage boundary mid-task.
  await markTreesForHarvest(
    context.tx,
    trees.filter((tree) => isFellable(treeView(tree), context.reading.gameNow)),
  );
  const refreshed = await requirePlot(context.tx, playerId, plot.id);
  return { ...written, plot: refreshed };
}

/**
 * Marks the trees of a batch (GDD section 132).
 *
 * The mark is server side only: `MARKED_FOR_HARVEST` never leaves the plot aggregate, because
 * every reading of this module treats a marked tree as live, and the contract frame of an
 * assignment carries the plot and not the trees (`shared/api/routes.ts`). What it buys is the
 * one thing the frozen schema cannot otherwise express: which trees the player selected.
 */
async function markTreesForHarvest(tx: Tx, trees: readonly TreeRecord[]): Promise<number> {
  if (trees.length === 0) {
    return 0;
  }
  const updated = await tx.tree.updateMany({
    where: { id: { in: trees.map((tree) => tree.id) }, status: TreeStatus.STANDING },
    data: { status: TreeStatus.MARKED_FOR_HARVEST },
  });
  return updated.count;
}

// ---------------------------------------------------------------------------
// REPLANT (GDD section 137)
// ---------------------------------------------------------------------------

export interface ReplantInput {
  readonly workerId: string;
  readonly poweredMachineId: string;
  readonly cells: readonly CellCoord[];
}

/**
 * Schedules a replanting of empty cells of a plot (GDD section 137).
 *
 * A separate operation from felling and never automatic: a cell left empty stays empty, exactly
 * like a field left `VIRGIN`, and converting it to arable land instead is the other half of the
 * decision GDD section 10 poses. The saplings are created at completion with age zero, which is
 * what GDD section 137 asks for and what the derived stage produces on its own, because their
 * planting instant is the instant the task ended.
 */
export async function assignReplantTask(
  context: MutationContext,
  world: World,
  playerId: PlayerId,
  forestPlotId: string,
  input: ReplantInput,
): Promise<ForestryAssignment> {
  const plot = await requirePlot(context.tx, playerId, forestPlotId);
  await requireIdlePlot(context.tx, plot);

  const cells = dedupeCells(input.cells);
  await requireCellsOfPlot(context.tx, plot, cells);
  await requireCellsWithoutTree(context.tx, world, cells);

  const worker = await resolveWorker(context.tx, playerId, input.workerId, null);
  const machinery = await resolveMachinery(
    context.tx,
    playerId,
    TaskOperation.REPLANT,
    [input.poweredMachineId],
    worker.farmId,
  );

  const written = await writeTask(context, playerId, {
    operation: TaskOperation.REPLANT,
    units: cells.length,
    worker,
    machinery,
    targetForestPlotId: plot.id,
    destinationFarmId: null,
    reservedStorageUnits: null,
  });
  const refreshed = await requirePlot(context.tx, playerId, plot.id);
  return { ...written, plot: refreshed };
}

/** Refuses a cell that is not part of the plot. */
async function requireCellsOfPlot(
  db: Db,
  plot: ForestPlotRecord,
  cells: readonly CellCoord[],
): Promise<void> {
  if (cells.length === 0) {
    throw new ApiError(ValidationCode.SELECTION_EMPTY, { entityId: plot.id });
  }
  const owned = new Set(
    (await plotCells(db, plot.id)).map((cell) => cellKey(cell.cellX, cell.cellY)),
  );
  for (const cell of cells) {
    if (!owned.has(cellKey(cell.cellX, cell.cellY))) {
      throw new ApiError(ValidationCode.CELL_NOT_OWNED, { cells: [cell] });
    }
  }
}

/**
 * Refuses a cell that already carries a tree (GDD section 130: zero or one tree per cell).
 *
 * The predicate is "not felled" and not "standing", so a tree already marked by a felling in
 * flight still occupies its cell. The partial unique index `trees_standing_cell_key` is the
 * safety net; this is the readable refusal.
 */
async function requireCellsWithoutTree(
  db: Db,
  world: World,
  cells: readonly CellCoord[],
): Promise<void> {
  if (cells.length === 0) {
    return;
  }
  const rows = await db.tree.findMany({
    where: {
      worldId: world.id,
      status: { in: [...LIVE_TREE_STATUSES] },
      OR: cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
    },
    select: { cellX: true, cellY: true },
    take: 1,
  });
  const occupied = rows[0];
  if (occupied !== undefined) {
    throw new ApiError(ValidationCode.CELL_ALREADY_HAS_TREE, {
      cells: [{ cellX: occupied.cellX, cellY: occupied.cellY }],
    });
  }
}

// ---------------------------------------------------------------------------
// CLEAR_LAND (GDD section 10)
// ---------------------------------------------------------------------------

export interface ClearLandInput {
  readonly workerId: string;
  readonly poweredMachineId: string;
  readonly implementMachineId: string;
  readonly cells: readonly CellCoord[];
  readonly forestPlotId?: string | undefined;
}

/**
 * Schedules the clearing of felled forest into arable land (GDD section 10).
 *
 * The economic cost GDD section 10 asks for is the operating cost of the task, integrated over
 * the interval it runs (plan section 6.2), and the machinery cost is the tractor and the plough
 * the compatibility table demands. Inventing a separate fee would be inventing a balance number
 * the GDD never published (`shared/config/machines.ts`, `CLEAR_LAND`).
 *
 * A CLEARING IS AN OPERATION ON A PLOT AND NOT ON AN ARBITRARY SET OF CELLS, and the reason is
 * the frozen schema: `tasks` has no column for a geometry, so the area has to be rebuilt at
 * completion from something that is stored. What is stored is the plot, and the derivable set is
 * "the cells of the plot that carry no live tree" — which is exactly the ground a felling
 * emptied, and exactly what GDD section 137 offers to convert ("el jugador puede optar por
 * convertir esas celdas a terreno agricola"). The request therefore has to name that whole set,
 * and a selection that is a strict subset is refused here rather than surprising the player with
 * a different subset of the same size three hundred game hours later (ADR-0050).
 */
export async function assignClearLandTask(
  services: MutationContext['services'],
  context: MutationContext,
  world: World,
  playerId: PlayerId,
  input: ClearLandInput,
): Promise<ForestryAssignment> {
  const cells = dedupeCells(input.cells);
  await requireValidForestSelection(
    services,
    context.tx,
    world,
    playerId,
    SelectionPurpose.CLEAR_LAND,
    cells,
  );
  // The shared rule reads `hasStandingTree`, which is an `EXISTS` over the trees whose status is
  // `STANDING`. A tree already marked by a felling in flight is not standing by that predicate
  // and is very much still there, so the stricter check is repeated here over every live tree.
  await requireCellsWithoutTree(context.tx, world, cells);

  const plot = await requireClearingPlot(context.tx, playerId, cells, input.forestPlotId ?? null);
  await requireIdlePlot(context.tx, plot);
  await requireWholeClearedPart(context.tx, plot, cells);

  const worker = await resolveWorker(context.tx, playerId, input.workerId, null);
  const machinery = await resolveMachinery(
    context.tx,
    playerId,
    TaskOperation.CLEAR_LAND,
    [input.poweredMachineId, input.implementMachineId],
    worker.farmId,
  );

  const written = await writeTask(context, playerId, {
    operation: TaskOperation.CLEAR_LAND,
    units: cells.length,
    worker,
    machinery,
    targetForestPlotId: plot.id,
    destinationFarmId: null,
    reservedStorageUnits: null,
  });
  const refreshed = await requirePlot(context.tx, playerId, plot.id);
  return { ...written, plot: refreshed };
}

/**
 * Refuses a clearing that does not cover the whole cleared part of its plot.
 *
 * The completion rebuilds the area as "the cells of the plot with no live tree", so a request
 * that named fewer cells than that would convert more ground than it asked for. Refusing it at
 * assignment, with both counts in the details, is the honest half of the limitation ADR-0050
 * records: the player is told what the operation is instead of discovering it afterwards.
 */
async function requireWholeClearedPart(
  db: Db,
  plot: ForestPlotRecord,
  cells: readonly CellCoord[],
): Promise<void> {
  const empty = await emptyCellsOfPlot(db, plot);
  const asked = new Set(cells.map((cell) => cellKey(cell.cellX, cell.cellY)));
  const missing = empty.filter((cell) => !asked.has(cellKey(cell.cellX, cell.cellY)));
  if (missing.length === 0 && empty.length === cells.length) {
    return;
  }
  throw validationFailed('cells', {
    entityId: plot.id,
    expectedCellCount: empty.length,
    cellCount: cells.length,
    ...(missing[0] === undefined ? {} : { cells: [missing[0]] }),
  });
}

/**
 * The plot a clearing leaves, taken from the request or derived from the cells.
 *
 * Every cell has to belong to the same live plot. A selection that spans two plots or that
 * includes ground belonging to none is refused rather than guessed, because the completion
 * rebuilds the area from the plot and a wrong plot would convert the wrong ground.
 */
async function requireClearingPlot(
  db: Db,
  playerId: PlayerId,
  cells: readonly CellCoord[],
  requestedPlotId: string | null,
): Promise<ForestPlotRecord> {
  const rows = await db.worldCell.findMany({
    where: {
      ownerPlayerId: playerId,
      OR: cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
    },
    select: { cellX: true, cellY: true, forestPlotId: true },
  });
  const plotIds = new Set(rows.map((row) => row.forestPlotId));
  if (rows.length !== cells.length || plotIds.size !== 1 || plotIds.has(null)) {
    throw validationFailed('forestPlotId', {
      cellCount: cells.length,
      reason: 'every cell of a clearing has to belong to the same forest plot',
    });
  }
  const [only] = [...plotIds];
  const forestPlotId = only as string;
  if (requestedPlotId !== null && requestedPlotId !== forestPlotId) {
    throw validationFailed('forestPlotId', { expected: forestPlotId, actual: requestedPlotId });
  }
  return requirePlot(db, playerId, forestPlotId);
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/**
 * Applies the completion of a forestry task, or reports that the event is not one of ours.
 *
 * Runs inside the transaction of the advance and after the event was claimed with a conditional
 * update, so it must not check the event status again; what it does check is the task status,
 * which is the transition gate of plan section 6.3 applied to the subject rather than to the
 * event. Every effect lives inside the branch that won that gate, which is what makes a
 * duplicate delivery a no-op.
 */
export async function completeForestryTask(context: ScheduledEventContext): Promise<boolean> {
  const { event, lock, tx } = context;
  if (event.refType !== TASK_REF_TYPE || event.refId === null) {
    return false;
  }
  const row = await tx.task.findUnique({ where: { id: event.refId }, select: TASK_SELECT });
  if (row === null) {
    return false;
  }
  const task = toTaskRecord(row);
  if (!isForestryOperation(task.operation)) {
    return false;
  }
  if (task.playerId !== lock.playerId) {
    // The event belongs to this player and the task to another: impossible unless a row was
    // written by hand. Claimed as ours and applied to nothing, so the advance cannot loop.
    return true;
  }

  const claimed = await tx.task.updateMany({
    where: { id: task.id, status: TaskStatus.IN_PROGRESS },
    data: { status: TaskStatus.COMPLETED, endedGameMs: event.dueGameMs, cancelable: false },
  });
  if (claimed.count === 0) {
    return true;
  }

  const atGameMs = event.dueGameMs;
  const frames: DomainEventDraft[] = [];

  if (task.operation === TaskOperation.FELL) {
    frames.push(...(await completeFell(context, task, atGameMs)));
  } else if (task.operation === TaskOperation.REPLANT) {
    frames.push(...(await completeReplant(context, task, atGameMs)));
  } else {
    frames.push(...(await completeClearLand(context, task, atGameMs)));
  }

  // The hours that wear the machines are the hours the operating cost is integrated over
  // (ADR-0040), which `applyMachineWearOverInterval` states as an invariant and not as a
  // coincidence: both read `[startGameMs, endedGameMs)`.
  await applyMachineWearOverInterval(tx, task.machineIds, task.startGameMs, atGameMs);
  const released = await releaseMachines(tx, task.machineIds, task.id);
  frames.push(...released.map((machine) => machineUpsertedFrame(machine)));

  const worker = await requireWorker(tx, task.playerId, task.workerId);
  frames.push(workerUpsertedFrame(await applyTaskCompletion(tx, worker, task.id)));

  const finished = await tx.task.findUniqueOrThrow({ where: { id: task.id }, select: TASK_SELECT });
  frames.push(taskUpsertedFrame(toTaskRecord(finished), atGameMs));

  context.emit(...frames);
  return true;
}

/** Effects of a completed felling (GDD sections 132, 135 and 136). */
async function completeFell(
  context: ScheduledEventContext,
  task: TaskRecord,
  atGameMs: GameMs,
): Promise<readonly DomainEventDraft[]> {
  const { tx } = context;
  const plotId = task.targetForestPlotId;
  if (plotId === null) {
    return [];
  }

  const rows = await tx.tree.findMany({
    where: { forestPlotId: plotId, status: TreeStatus.MARKED_FOR_HARVEST },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: TREE_SELECT,
  });
  const batchTrees = rows.map(toTreeRecord);
  // Recomputed at the instant of completion and not read from the task: the trees kept growing
  // while the harvester worked, and GDD section 135 says the wood produced is the sum of the
  // volumes of the trees that were felled, which is the volume they had when they fell.
  const produced = batchWoodVolume(batchTrees.map(treeView), atGameMs);

  await tx.tree.updateMany({
    where: { id: { in: batchTrees.map((tree) => tree.id) } },
    data: { status: TreeStatus.FELLED, felledAtGameMs: atGameMs },
  });

  const frames: DomainEventDraft[] = [];
  if (task.destinationFarmId !== null) {
    const deposit = await depositStorage(
      tx,
      task.destinationFarmId,
      StorageResource.WOOD_M3,
      produced.volumeDm3,
      { releaseReservedUnits: task.reservedStorageUnits ?? 0 },
    );
    if (deposit.wastedUnits > 0) {
      context.services.logger.warn(
        {
          taskId: task.id,
          farmId: task.destinationFarmId,
          acceptedUnits: deposit.acceptedUnits,
          wastedUnits: deposit.wastedUnits,
        },
        'wood store full at the completion of a felling: the surplus was wasted',
      );
    }
    frames.push(...(await farmFrames(context, task.destinationFarmId)));
  }

  await tx.forestPlot.updateMany({
    where: { id: plotId, currentTaskId: task.id },
    data: { currentTaskId: null },
  });
  const refreshed = await requirePlot(tx, task.playerId, plotId);
  const standing = await liveTreesOfArea(tx, plotId, null);
  const felled = await tx.tree.findMany({
    where: { id: { in: batchTrees.map((tree) => tree.id) } },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: TREE_SELECT,
  });

  const cells = batchTrees.map((tree) => ({ cellX: tree.cellX, cellY: tree.cellY }));
  if (cells.length > 0) {
    // `hasStandingTree` of the chunk overlay changed for every felled cell, and no column of
    // `world_cells` did, so the version has to be moved by hand.
    await bumpChunkVersions(
      context.services,
      tx,
      context.reading.world,
      chunksOfCells(cells, context.reading.world.chunkSize),
      context.reading.atRealMs,
    );
    frames.push(...(await chunkFrames(context.services, tx, context.reading.world, cells)));
  }

  await syncMilestoneSchedule(tx, context.outbox, context.reading, refreshed, atGameMs, standing);
  frames.push(
    treesUpsertedFrame(refreshed, standing, felled.map(toTreeRecord), atGameMs),
    forestPlotUpsertedFrame(refreshed, standing, atGameMs, null),
  );
  return frames;
}

/** Effects of a completed replanting (GDD section 137): saplings of age zero. */
async function completeReplant(
  context: ScheduledEventContext,
  task: TaskRecord,
  atGameMs: GameMs,
): Promise<readonly DomainEventDraft[]> {
  const { tx } = context;
  const plotId = task.targetForestPlotId;
  if (plotId === null) {
    return [];
  }
  const plot = await requirePlot(tx, task.playerId, plotId);
  const world = context.reading.world;

  const cells = (await emptyCellsOfPlot(tx, plot)).slice(0, task.unitsAtStart);
  const planted = await insertTrees(
    tx,
    world,
    plot,
    cells.map((cell) => ({
      cellX: cell.cellX,
      cellY: cell.cellY,
      // Age zero at the instant the task ended, which is what GDD section 137 asks for and what
      // the derived stage returns without anything being stored: `SAPLING`.
      plantedAtGameMs: atGameMs,
    })),
    { naturallyGenerated: false },
  );

  await tx.forestPlot.updateMany({
    where: { id: plotId, currentTaskId: task.id },
    data: { currentTaskId: null },
  });
  const refreshed = await requirePlot(tx, task.playerId, plotId);
  const standing = await liveTreesOfArea(tx, plotId, null);

  const frames: DomainEventDraft[] = [];
  if (planted.length > 0) {
    await bumpChunkVersions(
      context.services,
      tx,
      world,
      chunksOfCells(cells, world.chunkSize),
      context.reading.atRealMs,
    );
    frames.push(...(await chunkFrames(context.services, tx, world, cells)));
  }
  await syncMilestoneSchedule(tx, context.outbox, context.reading, refreshed, atGameMs, standing);
  frames.push(
    treesUpsertedFrame(refreshed, standing, planted, atGameMs),
    forestPlotUpsertedFrame(refreshed, standing, atGameMs, null),
  );
  return frames;
}

/** Effects of a completed clearing (GDD section 10): the terrain override and the geometry. */
async function completeClearLand(
  context: ScheduledEventContext,
  task: TaskRecord,
  atGameMs: GameMs,
): Promise<readonly DomainEventDraft[]> {
  const { tx } = context;
  const world = context.reading.world;
  const plotId = task.targetForestPlotId;
  if (plotId === null) {
    return [];
  }
  const plot = await requirePlot(tx, task.playerId, plotId);
  // The area of the clearing, rebuilt from its target: the cells of the plot that carry no live
  // tree. The plot was reserved by this task for the whole of its duration, so nothing could fell
  // or replant under it and the set is the one the assignment demanded the request cover.
  const cells = await emptyCellsOfPlot(tx, plot);

  const frames: DomainEventDraft[] = [];
  const outcome = await applyClearing(
    context.services,
    tx,
    world,
    task.playerId,
    cells,
    context.reading.atRealMs,
  );
  await tx.forestPlot.updateMany({
    where: { id: plotId, currentTaskId: task.id },
    data: { currentTaskId: null },
  });
  if (outcome.affected === 0) {
    return frames;
  }
  frames.push(...(await chunkFrames(context.services, tx, world, cells)));

  // A clearing that took every cell leaves no plot behind, and `forest_plots_geometry_check`
  // demands `cellCount > 0`: writing the zero would abort the completion, retry it five times
  // and strand worker, machinery and plot as reserved. The plot is closed the way every other
  // entity of the model is closed, with a logical deletion, so the felled batches it produced
  // stay auditable (GDD section 132, plan section 5.3).
  const remaining = await refreshPlotCellCount(tx, plotId);
  if (remaining === 0) {
    await tx.forestPlot.update({
      where: { id: plotId },
      data: { disposedGameMs: atGameMs },
    });
    frames.push(forestPlotRemovedFrame(plotId));
    return frames;
  }
  const refreshed = await requirePlot(tx, task.playerId, plotId);
  const standing = await liveTreesOfArea(tx, plotId, null);
  const geometry = await plotCells(tx, plotId);
  frames.push(forestPlotUpsertedFrame(refreshed, standing, atGameMs, geometry));
  return frames;
}

/** The frames a change of stock produces: the farm and its inventory line. */
async function farmFrames(
  context: ScheduledEventContext,
  farmId: string,
): Promise<readonly DomainEventDraft[]> {
  const farm = await context.tx.farm.findUnique({
    where: { id: farmId },
    select: {
      id: true,
      playerId: true,
      name: true,
      storedWheatLiters: true,
      reservedWheatLiters: true,
      capacityWheatLiters: true,
      storedWoodDm3: true,
      reservedWoodDm3: true,
      capacityWoodDm3: true,
      createdAtGameMs: true,
    },
  });
  if (farm === null) {
    return [];
  }
  const row: FarmRow = farm;
  const buildings = await loadBuildings(context.tx, [farmId]);
  return [
    { type: 'FARM_UPSERTED', payload: { farm: toFarmDto(row, buildings) } },
    { type: 'INVENTORY_UPSERTED', payload: { farms: [toInventoryFarm(row)] } },
  ];
}

// ---------------------------------------------------------------------------
// Cancellation support
// ---------------------------------------------------------------------------

/**
 * Undoes the marks of a cancelled felling (GDD sections 106 and 132).
 *
 * The release strategy `src/handlers.ts` registers in `lib/moduleSeams.ts`, because
 * `POST /api/tasks/:taskId/cancel` belongs to `modules/tasks` and rule 4 of plan section 11
 * forbids that module from importing this one, which is its sibling of the same phase
 * (docs/handoff/NOTES-w6c.md 2.2).
 *
 * It is narrow on purpose, and narrower than the version this file carried while the seam did
 * not exist. Everything a cancellation does that is not specific to this module —closing the
 * task, clearing `ForestPlot.currentTaskId`, the prorated wear, the release of the machines and
 * of the worker, the storage reservation and the retirement of the scheduled work— `cancelTask`
 * already does for every operation, using the requirement table of GDD section 90 to know that a
 * felling reserves wood. Repeating any of it here would release the same reservation twice and
 * corrupt `reservedWoodDm3`.
 *
 * What is left, and what only this module knows, is that the assignment marked the trees of the
 * batch: `MARKED_FOR_HARVEST` is how the lot the player selected is remembered (ADR-0050), and a
 * cancelled felling must give them back as standing, or they would count as neither alive nor
 * felled.
 */
export async function releaseForestryTask(
  tx: Tx,
  _outbox: Outbox,
  task: CancelledTaskView,
  atGameMs: GameMs,
): Promise<readonly DomainEventDraft[]> {
  if (task.operation !== TaskOperation.FELL || task.targetForestPlotId === null) {
    return [];
  }
  const restored = await tx.tree.updateMany({
    where: { forestPlotId: task.targetForestPlotId, status: TreeStatus.MARKED_FOR_HARVEST },
    data: { status: TreeStatus.STANDING },
  });
  if (restored.count === 0) {
    return [];
  }

  // The plot is read after the update, so the DTO the frames carry counts the trees that were
  // just given back. The geometry is null because a cancellation does not move a cell.
  const plot = await tx.forestPlot.findUnique({
    where: { id: task.targetForestPlotId },
    select: FOREST_PLOT_SELECT,
  });
  if (plot === null) {
    return [];
  }
  const record = toForestPlotRecord(plot);
  const standing = await standingTrees(tx, task.targetForestPlotId);
  return [
    forestPlotUpsertedFrame(record, standing, atGameMs, null),
    treesUpsertedFrame(record, standing, standing, atGameMs),
  ];
}

/** Free wood capacity of a farm, in cubic decimetres. */
export function freeWoodCapacity(farm: FarmRow): number {
  const usage = storageUsageOf(farm, StorageResource.WOOD_M3);
  const free = usage.capacityUnits - usage.storedUnits - usage.reservedUnits;
  return free > 0 ? free : 0;
}

export { liveTreesOfArea, emptyCellsOfPlot };
