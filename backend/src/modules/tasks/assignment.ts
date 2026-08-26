// The six checks of GDD section 104 and the duration formula of GDD section 91, evaluated
// once for the two routes that need them.
//
// Owner: workflow W6-A. Module `tasks`.
//
// THE ONE DECISION THIS FILE MAKES, from which everything else follows: the preview and the
// creation are the same evaluation, run in two modes. `POST /api/tasks/estimate` reports
// every reason the assignment would be refused, because the panel shows them all at once;
// `POST /api/tasks` throws the first of them, because a request is refused once and with a
// reason. If the two ran different code the panel would enable a button the server rejects,
// which is the failure ADR-0030 and ADR-0048 exist to prevent.
//
// THE ORDER OF THE CHECKS IS THE ORDER OF GDD SECTION 104 and it is not an implementation
// detail: ADR-0048 fixes that the reason a control is disabled is the reason the server
// would answer, which means the *first* reason of a fixed sequence. The sequence is:
//
//   1. The worker exists, belongs to the player and is idle.
//   2. The powered machine exists, belongs to the player and is idle.
//   3. The types are compatible with the operation (the table of GDD section 90).
//   4. The additional implement is free and assigned, when the operation takes one.
//   5. The target exists, belongs to the player and its state admits the transition.
//   6. If the operation sows, the crop is valid.
//
// Two refinements the sequence needs and GDD section 104 does not spell out. Step 3 is
// about types, and there is no type without a row, so the implement is *loaded* before step
// 3 and *judged* in step 4: a request naming a machine that does not exist is answered
// before one naming a machine that is busy. And the housing rule of GDD section 108 (a
// worker of one farm may not operate machinery of another) is checked with the machines, in
// step 4, because it is a property of the pair and not of either one; the trigger
// `task_machines_farm_guard` of the initial migration is its second line of defence.
//
// Nothing here writes. The evaluation reads, and the caller decides what to do with it,
// which is what lets `POST /api/tasks/estimate` be declared as a route that mutates nothing
// while sharing every line with the route that does.

import { toGameMs } from '../../lib/dbMap.js';
import { type ClockReading } from '../../lib/gameClock.js';
import { type Db } from '../../lib/tx.js';
import {
  ApiError,
  CROPS,
  CropCycleState,
  nextSowingWindowGameMs,
  seasonAtGameMs,
  MACHINE_CATALOGUE,
  MAX_SELECTION_CELLS,
  MIN_CONDITION_TO_ASSIGN,
  MachineRole,
  Money,
  OPERATION_REQUIREMENTS,
  storageTargetOf,
  TREE_SPECIES_CATALOGUE,
  ValidationCode,
  addGameMs,
  batchWoodVolume,
  cellKey,
  conditionAfterWork,
  estimateTaskDuration,
  explainIncompatibility,
  fieldStateNotAllowed,
  gameHoursToGameMs,
  isApiError,
  notFound,
  notOwned,
  type Bp,
  type CellCoord,
  type CropDefinition,
  type CropId,
  type GameMs,
  type MachineType,
  type OperationRequirement,
  type PlayerId,
  type StockItem,
  type StorageResource,
  type StorageResource as StorageResourceType,
  type TaskDurationEstimate,
  type TaskOperation,
  type TreeStatus,
  type TreeSpecies,
} from '../../shared/index.js';
import {
  CATEGORY_GRANTED_BY,
  freeStorageUnits,
  loadFarmStorage,
  requireFarm,
  storageUsageOf,
  type FarmRow,
  type FarmStorageRow,
} from '../farms/service.js';
import {
  cropOf,
  expectedYieldLiters,
  projectFieldPhase,
  settleAttributes,
} from '../fields/projection.js';
import { requireField, requireIdleField, type FieldRecord } from '../fields/service.js';
import { requireOperationAllowed } from '../fields/stateMachine.js';
import {
  definitionOf,
  machineAssignmentRefusal,
  assignmentError,
  requireMachine,
  type MachineRecord,
} from '../machinery/record.js';
import { requireIdleWorker, requireWorker, type WorkerRecord } from '../workers/service.js';

// ---------------------------------------------------------------------------
// The request, as the domain reads it
// ---------------------------------------------------------------------------

/**
 * An assignment, with the union of the fields the seven operations take.
 *
 * The wire form is a discriminated union per operation (`shared/api/schemas/tasks.ts`), so
 * the shape of the request is already decided by the schema: a sowing without a crop or a
 * felling against a field is a malformed request and never reaches here. This flat form is
 * what the evaluation works on, and its optional fields are the ones the table of GDD
 * section 90 decides are needed.
 */
export interface AssignmentRequest {
  readonly operation: TaskOperation;
  readonly workerId: string;
  readonly poweredMachineId: string;
  readonly implementMachineId?: string | undefined;
  readonly targetFieldId?: string | undefined;
  readonly targetForestPlotId?: string | undefined;
  readonly destinationFarmId?: string | undefined;
  readonly cropId?: CropId | undefined;
  readonly cells?: readonly CellCoord[] | undefined;
}

/** A forest plot, as this module reads it. Owned by `modules/forestry` (W6-C). */
export interface PlotRecord {
  readonly id: string;
  readonly playerId: string;
  readonly farmId: string | null;
  readonly cellCount: number;
  readonly currentTaskId: string | null;
}

/** What the two routes get out of one evaluation. */
export interface AssignmentEvaluation {
  readonly operation: TaskOperation;
  readonly requirement: OperationRequirement;
  /** Every rule the assignment fails, in the order of GDD section 104. Empty means feasible. */
  readonly blockers: readonly ApiError[];
  readonly worker: WorkerRecord | null;
  /** Powered machine first, then the implement. Only the ones that resolved. */
  readonly machines: readonly MachineRecord[];
  readonly field: FieldRecord | null;
  readonly plot: PlotRecord | null;
  readonly destinationFarm: FarmRow | null;
  readonly cells: readonly CellCoord[];
  /** Cells or trees the task would work on, which is the numerator of GDD section 91. */
  readonly units: number;
  readonly duration: TaskDurationEstimate;
  readonly startGameMs: GameMs;
  readonly durationGameMs: GameMs;
  readonly scheduledEndGameMs: GameMs;
  readonly operatingCost: Money;
  readonly workerWages: Money;
  readonly conditionLossBp: number;
  readonly storageResource: StorageResourceType | null;
  /** The pile the deposit lands in: one crop, or timber. Null when nothing is stored. */
  readonly storageItem: StockItem | null;
  readonly expectedProductionUnits: number | null;
  readonly reservedStorageUnits: number | null;
  readonly overflowUnits: number;
}

/** Whether an evaluation may be turned into a task. */
export function isFeasible(evaluation: AssignmentEvaluation): boolean {
  return evaluation.blockers.length === 0;
}

/** The first refusal of an evaluation, which is what the mutating route throws. */
export function firstBlocker(evaluation: AssignmentEvaluation): ApiError | undefined {
  return evaluation.blockers[0];
}

// ---------------------------------------------------------------------------
// The collector
// ---------------------------------------------------------------------------

/**
 * The mutable state of one evaluation. Confined to this file: what leaves it is the frozen
 * `AssignmentEvaluation`.
 */
interface Collector {
  readonly blockers: ApiError[];
  worker: WorkerRecord | null;
  powered: MachineRecord | null;
  implement: MachineRecord | null;
  field: FieldRecord | null;
  plot: PlotRecord | null;
  destinationFarm: FarmRow | null;
  destinationStorage: readonly FarmStorageRow[];
  /** The pile the task deposits into and the category it competes for, once resolved. */
  storageTarget: { readonly category: StorageResource; readonly item: StockItem } | null;
  cells: readonly CellCoord[];
  units: number;
  expectedProductionUnits: number | null;
}

/** Runs a check that throws, turning its refusal into a blocker. Returns null on refusal. */
async function attempt<T>(collector: Collector, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (isApiError(error)) {
      collector.blockers.push(error);
      return null;
    }
    throw error;
  }
}

/** The synchronous form of `attempt`, for the rules that are pure. */
function attemptSync(collector: Collector, run: () => void): boolean {
  try {
    run();
    return true;
  } catch (error) {
    if (isApiError(error)) {
      collector.blockers.push(error);
      return false;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The pace of a task (GDD section 91)
// ---------------------------------------------------------------------------

/**
 * The machine whose condition sets the pace of an operation.
 *
 * It mirrors `baseWorkSpeedForOperation` of `shared/rules/duration.ts`, which takes the
 * speed of the implement when it has one and of the powered machine otherwise: the
 * condition has to come from the same machine as the speed, or a worn plow behind a new
 * tractor would slow nothing down. For a harvest the trailer has no speed of its own, so
 * the combine sets both.
 */
export function paceMachineType(requirement: OperationRequirement): MachineType {
  const implement = requirement.requiredImplement;
  if (implement !== null && MACHINE_CATALOGUE[implement].workSpeedUnitsPerGameHour !== null) {
    return implement;
  }
  return requirement.poweredMachine;
}

/** Condition of the pace setting machine among the ones that resolved, or full condition. */
function paceConditionBp(
  requirement: OperationRequirement,
  machines: readonly MachineRecord[],
): Bp {
  const type = paceMachineType(requirement);
  const pace = machines.find((machine) => machine.type === type);
  return (pace ?? machines[0])?.conditionBp ?? (0 as Bp);
}

// ---------------------------------------------------------------------------
// The evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates an assignment against the six checks of GDD section 104 and the formula of GDD
 * section 91, reading and never writing.
 *
 * `db` is the transaction of the caller when this runs inside `withPlayerAdvanced`, so the
 * creation validates against the state its own writes will see; the estimate passes the
 * client and reads outside any transaction, which is correct because it commits to nothing.
 */
export async function evaluateAssignment(
  db: Db,
  playerId: PlayerId,
  reading: ClockReading,
  request: AssignmentRequest,
): Promise<AssignmentEvaluation> {
  const requirement = OPERATION_REQUIREMENTS[request.operation];
  const collector: Collector = {
    blockers: [],
    worker: null,
    powered: null,
    implement: null,
    field: null,
    plot: null,
    destinationFarm: null,
    destinationStorage: [],
    storageTarget: null,
    cells: [],
    units: 0,
    expectedProductionUnits: null,
  };

  await checkWorker(db, playerId, request, collector);
  await checkPoweredMachine(db, playerId, request, requirement, collector);
  await loadImplement(db, playerId, request, requirement, collector);
  await checkCompatibility(db, playerId, request, requirement, collector);
  checkImplementAvailability(requirement, collector);
  checkWorkerFarm(collector);
  await checkTarget(db, playerId, reading, request, requirement, collector);
  checkCrop(reading, request, requirement, collector);
  await checkStorage(db, playerId, request, requirement, collector);

  return summarise(reading, request, requirement, collector);
}

// --- 1. The worker (GDD section 104, check 1) -------------------------------

async function checkWorker(
  db: Db,
  playerId: PlayerId,
  request: AssignmentRequest,
  collector: Collector,
): Promise<void> {
  const worker = await attempt(collector, () => requireWorker(db, playerId, request.workerId));
  if (worker === null) {
    return;
  }
  collector.worker = worker;
  // The refusal is the shared rule of `modules/workers`, which checks the status and the
  // reservation column: they answer different questions and a row where they disagree is a
  // bug that must not become a second task on one worker (ADR-0040).
  attemptSync(collector, () => {
    requireIdleWorker(worker);
  });
}

// --- 2. The powered machine (GDD section 104, check 2) ----------------------

async function checkPoweredMachine(
  db: Db,
  playerId: PlayerId,
  request: AssignmentRequest,
  requirement: OperationRequirement,
  collector: Collector,
): Promise<void> {
  const machine = await attempt(collector, () =>
    requireMachine(db, playerId, request.poweredMachineId),
  );
  if (machine === null) {
    return;
  }
  collector.powered = machine;
  if (machineAssignmentRefusal(machine, MIN_CONDITION_TO_ASSIGN) !== null) {
    collector.blockers.push(assignmentError(machine, MIN_CONDITION_TO_ASSIGN));
  }
  void requirement;
}

// --- The implement row, needed before the table of GDD section 90 can be read

async function loadImplement(
  db: Db,
  playerId: PlayerId,
  request: AssignmentRequest,
  requirement: OperationRequirement,
  collector: Collector,
): Promise<void> {
  const named = request.implementMachineId;
  if (named === undefined) {
    if (requirement.requiredImplement !== null) {
      // Unreachable through the HTTP surface, where the schema of the operation makes the
      // field mandatory. Reachable from a caller inside the process, and the code is the
      // one the table of GDD section 90 would produce anyway.
      collector.blockers.push(
        new ApiError(ValidationCode.IMPLEMENT_REQUIRED, {
          operation: request.operation,
          requiredMachineType: requirement.requiredImplement,
        }),
      );
    }
    return;
  }
  const machine = await attempt(collector, () => requireMachine(db, playerId, named));
  if (machine !== null) {
    collector.implement = machine;
  }
}

// --- 3. Compatibility of operation and machinery (GDD sections 90 and 104) --

async function checkCompatibility(
  db: Db,
  playerId: PlayerId,
  request: AssignmentRequest,
  requirement: OperationRequirement,
  collector: Collector,
): Promise<void> {
  if (collector.powered === null) {
    // Without the powered machine there is no type to compare, and the missing row was
    // already reported. Reporting the table as well would blame the wrong thing.
    return;
  }
  const offeredMachineTypes = resolvedMachines(collector).map((machine) => machine.type);
  const ownedMachineTypes =
    requirement.requiredPossession.length === 0 ? [] : await ownedTypes(db, playerId);

  // The whole of GDD section 90 lives in `shared/rules/machinery.ts`, and it already
  // returns its codes in the order of that table: the powered machine, the implement, the
  // machines that are offered and not needed, and the possession requirements. That order
  // is the order of GDD section 104, so the list is reported as it comes.
  const codes = explainIncompatibility(
    {
      operation: request.operation,
      offeredMachineTypes,
      ownedMachineTypes,
      // The roles as the request named them, so that swapping the two machines is refused
      // instead of passing as the same multiset of types (GDD section 90 is a table of roles).
      poweredMachineType: collector.powered.type,
      implementMachineType: collector.implement?.type ?? null,
    },
    { catalogue: MACHINE_CATALOGUE, requirements: OPERATION_REQUIREMENTS },
  );
  for (const code of codes) {
    collector.blockers.push(
      new ApiError(code, {
        operation: request.operation,
        machineType: collector.powered.type,
        requiredMachineType: requirement.poweredMachine,
      }),
    );
  }
}

/** Types of live machinery the player owns, for the possession rules of GDD section 134. */
async function ownedTypes(db: Db, playerId: PlayerId): Promise<readonly MachineType[]> {
  const rows = await db.machine.groupBy({
    by: ['type'],
    where: { playerId, disposedGameMs: null },
  });
  return rows.map((row) => row.type);
}

// --- 4. The implement is free (GDD section 104, check 4) --------------------

function checkImplementAvailability(requirement: OperationRequirement, collector: Collector): void {
  const implement = collector.implement;
  if (implement === null) {
    return;
  }
  if (machineAssignmentRefusal(implement, MIN_CONDITION_TO_ASSIGN) !== null) {
    collector.blockers.push(assignmentError(implement, MIN_CONDITION_TO_ASSIGN));
  }
  void requirement;
}

/**
 * A worker may only operate machinery of his own farm (GDD section 108).
 *
 * The application half of the rule; the trigger `task_machines_farm_guard` is the other
 * half and is the one that holds even if a future caller forgets this one, because the task
 * is the single authoritative link between a worker and a machine (plan section 5.2).
 */
function checkWorkerFarm(collector: Collector): void {
  const worker = collector.worker;
  if (worker === null) {
    return;
  }
  for (const machine of resolvedMachines(collector)) {
    if (machine.farmId !== worker.farmId) {
      collector.blockers.push(
        new ApiError(ValidationCode.WORKER_WRONG_FARM, {
          entityId: worker.id,
          expected: machine.farmId,
          actual: worker.farmId,
        }),
      );
      return;
    }
  }
}

// --- 5. The target (GDD section 104, check 5) ------------------------------

async function checkTarget(
  db: Db,
  playerId: PlayerId,
  reading: ClockReading,
  request: AssignmentRequest,
  requirement: OperationRequirement,
  collector: Collector,
): Promise<void> {
  switch (requirement.targetKind) {
    case 'FIELD':
      await checkFieldTarget(db, playerId, reading, request, collector);
      return;
    case 'FOREST_PLOT':
      await checkPlotTarget(db, playerId, reading, request, requirement, collector);
      return;
    default:
      checkCellsTarget(request, collector);
  }
}

/**
 * The field, its reservation and its state (GDD sections 76, 90 and 104).
 *
 * The state compared is the projected one and never the stored one: a field whose
 * `FIELD_ADVANCE_PHASE` job has not run yet is already `READY_TO_HARVEST` and a harvest
 * assigned to it has to be accepted (plan section 6.5). The transition is materialised by
 * `applyFieldOperation` when the task completes, in the same transaction as its effects,
 * so nothing is written here.
 */
async function checkFieldTarget(
  db: Db,
  playerId: PlayerId,
  reading: ClockReading,
  request: AssignmentRequest,
  collector: Collector,
): Promise<void> {
  const named = request.targetFieldId;
  if (named === undefined) {
    collector.blockers.push(
      new ApiError(ValidationCode.TARGET_KIND_MISMATCH, { operation: request.operation }),
    );
    return;
  }
  const field = await attempt(collector, () => requireField(db, playerId, named));
  if (field === null) {
    return;
  }
  collector.field = field;
  collector.units = field.cellCount;

  attemptSync(collector, () => {
    requireIdleField(field);
  });

  const projected = projectFieldPhase(field, reading.gameNow);
  attemptSync(collector, () => {
    requireOperationAllowed(request.operation, projected.state);
  });
}

/**
 * The forest plot and the trees a felling or a replanting would work on (GDD sections 132,
 * 135 and 137).
 *
 * The rows are read and never written, and the stage of each tree comes from
 * `shared/rules/forestry.ts`, which is the module the felling route of `modules/forestry`
 * uses as well: `POST /api/tasks/estimate` accepts the seven operations by contract, and a
 * preview that could not answer for the three forestry ones would leave the panels of that
 * area without the figures they are built around. `modules/forestry` is a sibling of this
 * phase and cannot be imported (plan section 11, rule 4), which is why the read is here and
 * the writing half is not (`docs/handoff/NOTES-w6a.md`, item 3.1).
 */
async function checkPlotTarget(
  db: Db,
  playerId: PlayerId,
  reading: ClockReading,
  request: AssignmentRequest,
  requirement: OperationRequirement,
  collector: Collector,
): Promise<void> {
  const named = request.targetForestPlotId;
  if (named === undefined) {
    collector.blockers.push(
      new ApiError(ValidationCode.TARGET_KIND_MISMATCH, { operation: request.operation }),
    );
    return;
  }
  const row = await db.forestPlot.findUnique({
    where: { id: named },
    select: {
      id: true,
      playerId: true,
      farmId: true,
      cellCount: true,
      currentTaskId: true,
      disposedGameMs: true,
    },
  });
  if (row === null || row.disposedGameMs !== null) {
    collector.blockers.push(notFound('ForestPlot', named));
    return;
  }
  if (row.playerId !== playerId) {
    collector.blockers.push(notOwned('ForestPlot', named));
    return;
  }
  const plot: PlotRecord = {
    id: row.id,
    playerId: row.playerId,
    farmId: row.farmId,
    cellCount: row.cellCount,
    currentTaskId: row.currentTaskId,
  };
  collector.plot = plot;
  if (plot.currentTaskId !== null) {
    collector.blockers.push(
      new ApiError(ValidationCode.FIELD_HAS_ACTIVE_TASK, {
        entityKind: 'forestPlot',
        entityId: plot.id,
      }),
    );
  }

  if (request.operation === 'REPLANT') {
    const cells = dedupe(request.cells ?? []);
    collector.cells = cells;
    collector.units = cells.length;
    if (cells.length === 0) {
      collector.blockers.push(new ApiError(ValidationCode.SELECTION_EMPTY, { cellCount: 0 }));
    }
    return;
  }

  const restriction = request.cells === undefined ? null : dedupe(request.cells);
  const trees = await db.tree.findMany({
    where: {
      forestPlotId: plot.id,
      status: { not: 'FELLED' },
      ...(restriction === null
        ? {}
        : { OR: restriction.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })) }),
    },
    select: { species: true, plantedAtGameMs: true, status: true },
  });
  const batch = batchWoodVolume(
    trees.map((tree) => ({
      species: tree.species as TreeSpecies,
      plantedAtGameMs: toGameMs(tree.plantedAtGameMs),
      status: tree.status as TreeStatus,
    })),
    reading.gameNow,
    TREE_SPECIES_CATALOGUE,
  );
  // GDD section 135 makes the duration depend on the trees of the area and GDD section 131
  // gives a sapling no commercial value, so the count drives the duration and only the
  // fellable ones drive the volume.
  collector.units = batch.treeCount;
  collector.expectedProductionUnits = batch.volumeDm3;
  if (batch.treeCount === 0) {
    collector.blockers.push(
      new ApiError(ValidationCode.NO_FELLABLE_TREES, { entityId: plot.id, cellCount: 0 }),
    );
  } else if (batch.fellableCount === 0) {
    collector.blockers.push(
      new ApiError(ValidationCode.TREE_STAGE_NOT_FELLABLE, {
        entityId: plot.id,
        cellCount: batch.treeCount,
      }),
    );
  }
  void requirement;
}

/**
 * A target that is a set of cells, which is the clearing of GDD section 10.
 *
 * Only the shape of the selection is checked here: that it is not empty and that it is
 * within the shared ceiling. Whether each cell is owned, is free of standing trees and
 * carries felled forest is the `CLEAR_LAND` purpose of `shared/rules/selection.ts` applied
 * by the route that owns the operation, which is `modules/forestry` (W6-C).
 */
function checkCellsTarget(request: AssignmentRequest, collector: Collector): void {
  const cells = dedupe(request.cells ?? []);
  collector.cells = cells;
  collector.units = cells.length;
  if (cells.length === 0) {
    collector.blockers.push(new ApiError(ValidationCode.SELECTION_EMPTY, { cellCount: 0 }));
    return;
  }
  if (cells.length > MAX_SELECTION_CELLS) {
    collector.blockers.push(
      new ApiError(ValidationCode.SELECTION_TOO_LARGE, {
        cellCount: cells.length,
        limit: MAX_SELECTION_CELLS,
      }),
    );
  }
}

// --- 6. The crop (GDD section 104, check 6) --------------------------------

/**
 * The crop of a sowing, and only of a sowing.
 *
 * Four rules, and the third is the one that is easy to lose: GDD section 76 marks the
 * transition `PLOWED -> SEEDED` as conditional on the crop, through `requiresCultivation`,
 * and the requirement table lists both origins because wheat admits both. A crop that did
 * require cultivating would have to be refused from `PLOWED`, and the table alone does not
 * say so.
 *
 * The fourth is the sowing window. Only the instant of sowing is checked: a cycle that runs
 * past the end of its season is not penalised, because the world advances while the player
 * is away and a penalty applied then would be a punishment for having been offline. The
 * refusal carries the seasons the crop admits and the instant the next one opens, so the
 * panel can answer "maize is sown in spring, three days from now".
 */
function checkCrop(
  reading: ClockReading,
  request: AssignmentRequest,
  requirement: OperationRequirement,
  collector: Collector,
): void {
  const cropId = request.cropId ?? null;
  if (!requirement.requiresCrop) {
    if (cropId !== null) {
      collector.blockers.push(
        new ApiError(ValidationCode.FIELD_CROP_NOT_ALLOWED, { operation: request.operation }),
      );
    }
    return;
  }
  if (cropId === null) {
    collector.blockers.push(
      new ApiError(ValidationCode.FIELD_CROP_REQUIRED, { operation: request.operation }),
    );
    return;
  }
  const crop: CropDefinition | undefined = CROPS[cropId];
  if (crop === undefined) {
    collector.blockers.push(new ApiError(ValidationCode.CROP_UNKNOWN, { entityId: cropId }));
    return;
  }
  const season = seasonAtGameMs(reading.gameNow);
  if (!crop.sowingSeasons.includes(season)) {
    const opensAt = nextSowingWindowGameMs(crop.sowingSeasons, reading.gameNow);
    collector.blockers.push(
      new ApiError(ValidationCode.CROP_OUT_OF_SEASON, {
        entityId: cropId,
        season,
        allowedSeasons: [...crop.sowingSeasons],
        ...(opensAt === null ? {} : { nextWindowAtGameMs: String(opensAt) }),
      }),
    );
    return;
  }
  const field = collector.field;
  if (field === null) {
    return;
  }
  if (crop.requiresCultivation && field.cropCycleState === CropCycleState.PLOWED) {
    collector.blockers.push(
      fieldStateNotAllowed(request.operation, field.cropCycleState, [CropCycleState.CULTIVATED]),
    );
  }
}

// --- Storage of the destination (GDD sections 83 and 97) -------------------

/**
 * The store that receives what the task produces, and the capacity it commits.
 *
 * Three layers, of which this is the first (plan section 5.4). A destination with no store
 * at all and a store with no room left are refusals, because both are actionable before the
 * task starts: raise a silo, or sell the grain. A store with *some* room is not a refusal:
 * plan section 2.2 resolves GDD sections 83 and 97 as a warning at assignment, a fill to
 * capacity at completion and the rest wasted with an entry and a line in the return summary,
 * so the estimate reports `overflowUnits` and the assignment goes ahead.
 */
async function checkStorage(
  db: Db,
  playerId: PlayerId,
  request: AssignmentRequest,
  requirement: OperationRequirement,
  collector: Collector,
): Promise<void> {
  if (requirement.requiresStorage === null) {
    return;
  }
  // A harvest names no crop in its request: the crop is the one standing on the field, and
  // it decides which store has to have room. Potatoes must not fill the grain silo.
  const target = storageTargetOf(
    request.operation,
    collector.field?.cropId ?? null,
    CROPS,
    OPERATION_REQUIREMENTS,
  );
  if (target === null) {
    // The operation stores something but the field carries no crop, which `checkTarget`
    // already refused through the state machine. Nothing to add.
    return;
  }
  collector.storageTarget = target;

  const named = request.destinationFarmId;
  if (named === undefined) {
    collector.blockers.push(
      new ApiError(ValidationCode.STORAGE_REQUIRED, { operation: request.operation }),
    );
    return;
  }
  const farm = await attempt(collector, () => requireFarm(db, playerId, named));
  if (farm === null) {
    return;
  }
  collector.destinationFarm = farm;
  const storage = await loadFarmStorage(db, [farm.id]);
  collector.destinationStorage = storage;

  const usage = storageUsageOf(storage, target.category);
  if (usage.capacityUnits <= 0) {
    collector.blockers.push(
      new ApiError(ValidationCode.STORAGE_REQUIRED, {
        entityId: farm.id,
        entityKind: CATEGORY_GRANTED_BY[target.category],
        availableUnits: 0,
      }),
    );
    return;
  }
  if (freeStorageUnits(storage, target.category) <= 0) {
    collector.blockers.push(
      new ApiError(ValidationCode.STORAGE_CAPACITY_EXCEEDED, {
        entityId: farm.id,
        entityKind: CATEGORY_GRANTED_BY[target.category],
        occupancy: usage.storedUnits + usage.reservedUnits,
        capacity: usage.capacityUnits,
        availableUnits: 0,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// The figures (GDD sections 91, 93, 94 and 107)
// ---------------------------------------------------------------------------

function summarise(
  reading: ClockReading,
  request: AssignmentRequest,
  requirement: OperationRequirement,
  collector: Collector,
): AssignmentEvaluation {
  const machines = resolvedMachines(collector);
  const worker = collector.worker;
  const units = collector.units;

  if (units <= 0 && collector.blockers.length === 0) {
    // Every target that can be empty already reported it; this covers a field whose cell
    // count is somehow zero, which the `CHECK` on the task row would refuse anyway.
    collector.blockers.push(new ApiError(ValidationCode.SELECTION_EMPTY, { cellCount: 0 }));
  }

  const duration = estimateTaskDuration({
    operation: request.operation,
    units,
    conditionBp: paceConditionBp(requirement, machines),
    skillBp: worker?.skillBp ?? (0 as Bp),
  });

  const durationGameMs =
    duration.effectiveWorkSpeedUnitsPerGameHour > 0
      ? gameHoursToGameMs(duration.durationGameHours)
      : (0n as GameMs);
  const startGameMs = reading.gameNow;
  const scheduledEndGameMs = addGameMs(startGameMs, durationGameMs);

  // GDD section 94: the operating cost is paid only while the machine works, and it is the
  // integral over `[start, end)` that `lib/accrual.ts` charges. Computing it with the same
  // interval is what makes the preview and the ledger agree.
  const operatingCost = Money.sum(
    machines.map((machine) =>
      Money.mulGameMs(definitionOf(machine.type).operatingCostPerGameHour, durationGameMs),
    ),
  );
  // GDD section 107: the wage is paid whether the worker is idle or working, so this is not
  // a cost of the task. It travels because the panel compares two candidates.
  const workerWages =
    worker === null ? Money.ZERO : Money.mulGameMs(worker.salaryPerGameHour, durationGameMs);

  const production = expectedProduction(reading, requirement, collector, scheduledEndGameMs);
  const free =
    collector.destinationFarm === null || collector.storageTarget === null
      ? 0
      : freeStorageUnits(collector.destinationStorage, collector.storageTarget.category);
  const reserved = production === null ? null : Math.min(production, free);
  const overflow = production === null ? 0 : Math.max(0, production - free);

  return {
    operation: request.operation,
    requirement,
    blockers: collector.blockers,
    worker,
    machines,
    field: collector.field,
    plot: collector.plot,
    destinationFarm: collector.destinationFarm,
    cells: collector.cells,
    units,
    duration,
    startGameMs,
    durationGameMs,
    scheduledEndGameMs,
    operatingCost,
    workerWages,
    conditionLossBp: worstConditionLossBp(machines, duration.durationGameHours),
    storageResource: collector.storageTarget?.category ?? null,
    storageItem: collector.storageTarget?.item ?? null,
    expectedProductionUnits: production,
    reservedStorageUnits: reserved,
    overflowUnits: overflow,
  };
}

/**
 * What the task would produce, in the stored unit of its resource.
 *
 * For a harvest it is the yield of GDD section 83 with the attributes settled to the
 * instant the task would *end* and not to now, which is the honest figure: the field stays
 * `READY_TO_HARVEST` while the combine works and the weeds of GDD section 78 keep growing
 * during it. It is also what makes the reservation exact, because the completion handler
 * computes the yield with the same function at the same instant.
 */
function expectedProduction(
  reading: ClockReading,
  requirement: OperationRequirement,
  collector: Collector,
  atGameMs: GameMs,
): number | null {
  if (collector.expectedProductionUnits !== null) {
    return collector.expectedProductionUnits;
  }
  if (requirement.toCropState !== CropCycleState.HARVESTED) {
    return null;
  }
  const field = collector.field;
  if (field === null) {
    return null;
  }
  const crop = cropOf(field.cropId);
  const settled = settleAttributes(field, atGameMs, crop);
  void reading;
  return expectedYieldLiters(field, settled, crop);
}

/**
 * Condition the task would cost, in basis points, as the worst of the machines it reserves.
 *
 * The contract carries one figure and the catalogue gives a rate per type, so a harvest
 * with a combine at 25 bp/h and a trailer at 15 bp/h has two answers. The worst one is
 * reported, because the figure exists to warn, and a warning that quoted the gentler of the
 * two would be the one number the player must not trust. The clamp of `conditionAfterWork`
 * is respected, so a machine that would reach zero reports what it really has left.
 */
function worstConditionLossBp(
  machines: readonly MachineRecord[],
  durationGameHours: number,
): number {
  let worst = 0;
  for (const machine of machines) {
    const after = conditionAfterWork(
      machine.conditionBp,
      durationGameHours,
      definitionOf(machine.type),
    );
    const loss = machine.conditionBp - after;
    if (loss > worst) {
      worst = loss;
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** The machines that resolved, powered first, which is the order the task row keeps. */
function resolvedMachines(collector: Collector): readonly MachineRecord[] {
  const machines: MachineRecord[] = [];
  if (collector.powered !== null) {
    machines.push(collector.powered);
  }
  if (collector.implement !== null) {
    machines.push(collector.implement);
  }
  return machines;
}

/** The role each machine of a task plays, which is the column of `task_machines`. */
export function roleOfMachine(machine: MachineRecord): MachineRole {
  return definitionOf(machine.type).role === MachineRole.POWERED
    ? MachineRole.POWERED
    : MachineRole.IMPLEMENT;
}

/** Deduplicates a selection, preserving the order the request sent. */
function dedupe(cells: readonly CellCoord[]): readonly CellCoord[] {
  const seen = new Set<number>();
  const unique: CellCoord[] = [];
  for (const cell of cells) {
    const key = cellKey(cell.cellX, cell.cellY);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({ cellX: cell.cellX, cellY: cell.cellY });
  }
  return unique;
}
