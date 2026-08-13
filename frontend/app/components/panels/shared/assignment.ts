// The assignment of a worker and machinery to an operation, as the interface judges it.
//
// Owner: W6-D. Read by the assignment panel, the forestry listing and the plot inspector.
//
// This module exists because of ADR-0048 and it is the hardest case that decision covers.
// The assignment is the one request of the game where six independent rules are true at
// once as a matter of routine: the only idle worker is on another farm, the only free
// tractor is below the condition floor, the field already has a task and the silo is full.
// The server answers exactly one of them, the first of the sequence of GDD section 104, and
// a panel that picks a different one sends the player to fix something that does not unblock
// anything.
//
// So the order below is not "the checks, in some order". It is
// `backend/src/modules/tasks/assignment.ts` transcribed, function by function, in the order
// `evaluateAssignment` runs them:
//
//   1. `checkWorker`                the worker exists, is the player's and is idle
//   2. `checkPoweredMachine`        the powered machine exists, is the player's, is idle and
//                                   is above the condition floor
//   3. `loadImplement`              the implement of the operation is named and exists
//   4. `checkCompatibility`         the table of GDD section 90, through `explainIncompatibility`
//   5. `checkImplementAvailability` the implement is idle and above the floor
//   6. `checkWorkerFarm`            the worker and the machines belong to the same farm (GDD 108)
//   7. `checkTarget`                the target exists, is the player's, and its state admits it
//   8. `checkCrop`                  a sowing names a crop of the catalogue
//   9. `checkStorage`               the destination has a store with room (GDD sections 83 and 97)
//
// The declared duplication has a bound, and it is worth stating what is *not* duplicated:
// the compatibility table itself is `explainIncompatibility` of `shared/rules/machinery.ts`,
// the same function the server calls; the states an operation may start from are
// `OPERATION_REQUIREMENTS.fromCropStates` and the transitions are `CROP_CYCLE_TRANSITIONS`,
// both of `shared/config`; and the duration is `estimateTaskDuration`. What is written twice
// is the *sequence*, because `shared/` is frozen and the server does not publish it
// (ADR-0048, "coste asumido").
//
// Everything here is pure and takes its instant as a parameter, so the suite asserts the
// code rather than the sentence, and the ties — two reasons true at once — are fixed by a
// test and not by whichever branch happens to run first.

import {
  CROPS,
  MACHINE_CATALOGUE,
  MIN_CONDITION_TO_ASSIGN,
  MachineStatus,
  OPERATION_REQUIREMENTS,
  StorageResource,
  TaskOperation,
  ValidationCode,
  WorkerStatus,
  bp,
  canAssignMachine,
  explainIncompatibility,
  type CropId,
  type FieldDto,
  type ForestPlotDto,
  type MachineDefinition,
  type MachineDto,
  type MachineType,
  type OperationRequirement,
  type WorkerDto,
} from '~/shared/index';
import { operationsFromState } from '~/stores/fields';

// ---------------------------------------------------------------------------
// Operations a field admits
// ---------------------------------------------------------------------------

/**
 * Operations the state machine of GDD section 76 admits from a state.
 *
 * Delegated to `operationsFromState` of `stores/fields.ts`, which reads
 * `CROP_CYCLE_TRANSITIONS`, rather than written again here: two readings of one table are
 * two chances to disagree about `PLOWED -> SEEDED`, which is the transition GDD section 76
 * states in a note and GDD section 90 states outright.
 */
export { operationsFromState };

/**
 * Operations offered for a field, from its projected state and not its stored one.
 *
 * The two differ exactly while a materialising job has not run yet (plan section 6.5), and
 * the server validates against the projection, so offering the stored state would hide an
 * operation the server would accept. It is the same choice ADR-0035 made for the field
 * inspector, applied to the control that acts.
 */
export function operationsForField(field: FieldDto): readonly TaskOperation[] {
  return operationsFromState(field.projection.cropCycleState);
}

/** Operations that act on a forest plot or on a set of cells (GDD sections 132, 137 and 10). */
export const FORESTRY_OPERATIONS: readonly TaskOperation[] = [
  TaskOperation.FELL,
  TaskOperation.REPLANT,
  TaskOperation.CLEAR_LAND,
];

/** Requirement row of an operation, which is the entry point into the table of GDD 90. */
export function requirementOf(operation: TaskOperation): OperationRequirement {
  return OPERATION_REQUIREMENTS[operation];
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export interface WorkerChoice {
  readonly worker: WorkerDto;
  /** Why this worker cannot take the task, or null when he can. */
  readonly code: ValidationCode | null;
  readonly usable: boolean;
}

/**
 * Why a worker cannot be assigned, in the order of `checkWorker` and `checkWorkerFarm`.
 *
 * The two are far apart in the sequence of the server — the status is check 1 and the farm
 * is check 6 — and that distance is preserved here by returning the status first: a worker
 * who is both busy and of another farm reads as busy, which is what the server would say.
 */
export function workerBlockingCode(
  worker: WorkerDto,
  machineFarmId: string | null,
): ValidationCode | null {
  if (worker.status !== WorkerStatus.IDLE || worker.currentTaskId !== null) {
    return ValidationCode.WORKER_NOT_IDLE;
  }
  if (machineFarmId !== null && worker.farmId !== machineFarmId) {
    return ValidationCode.WORKER_WRONG_FARM;
  }
  return null;
}

/** Every worker of the payroll with its verdict, in the order the caller supplied them. */
export function workerChoices(
  workers: readonly WorkerDto[],
  machineFarmId: string | null,
): readonly WorkerChoice[] {
  return workers.map((worker) => {
    const code = workerBlockingCode(worker, machineFarmId);
    return { worker, code, usable: code === null };
  });
}

// ---------------------------------------------------------------------------
// Machine combinations (GDD section 90)
// ---------------------------------------------------------------------------

export interface MachineCombination {
  /** Stable key of the row: the identifiers the task would reserve, in order. */
  readonly key: string;
  readonly machineIds: readonly string[];
  readonly powered: MachineDto;
  readonly implement: MachineDto | null;
  /** Machine whose condition sets the pace: the implement when there is one (GDD 91). */
  readonly paceMachine: MachineDto;
  /** Why the combination is refused, or null. The first code of the server sequence. */
  readonly code: ValidationCode | null;
  readonly usable: boolean;
}

/**
 * Why one combination is refused, in the order of checks 2 to 5 of the server.
 *
 * The powered machine is judged before the compatibility of the pair and the implement is
 * judged after it, which is the one ordering of this file that is not obvious and is not
 * arbitrary: `checkCompatibility` runs on types and `checkImplementAvailability` runs on the
 * row, so a worn plow behind a busy tractor reports the tractor, and an incompatible pair of
 * two idle machines reports the table of GDD section 90.
 */
export function combinationBlockingCode(input: {
  readonly operation: TaskOperation;
  readonly powered: MachineDto;
  readonly implement: MachineDto | null;
  /** Types the player owns, for the possession requirements (GDD section 134). */
  readonly ownedMachineTypes: readonly MachineType[];
}): ValidationCode | null {
  const poweredRefusal = canAssignMachine(
    {
      type: input.powered.type,
      conditionBp: bp(input.powered.conditionBp),
      status: input.powered.status,
    },
    MIN_CONDITION_TO_ASSIGN,
  );
  if (poweredRefusal !== null) {
    return poweredRefusal;
  }

  const offered: MachineType[] = [input.powered.type];
  if (input.implement !== null) {
    offered.push(input.implement.type);
  }
  const incompatibility = explainIncompatibility({
    operation: input.operation,
    offeredMachineTypes: offered,
    ownedMachineTypes: input.ownedMachineTypes,
    // The two roles, which this caller does know: the same reading the server makes of the
    // table of GDD section 90, so the greyed row and the 400 keep naming the same rule.
    poweredMachineType: input.powered.type,
    implementMachineType: input.implement === null ? null : input.implement.type,
  });
  const first = incompatibility[0];
  if (first !== undefined) {
    return first;
  }

  if (input.implement !== null) {
    return canAssignMachine(
      {
        type: input.implement.type,
        conditionBp: bp(input.implement.conditionBp),
        status: input.implement.status,
      },
      MIN_CONDITION_TO_ASSIGN,
    );
  }
  return null;
}

/**
 * Every combination the player could offer for an operation, valid or not, with its reason.
 *
 * Every one and not only the valid ones, which is the whole request of the brief: a selector
 * that hides what does not work leaves the player with an empty list and no explanation,
 * while a selector that shows a greyed row with "the machine is not available" next to it
 * says which machine to free. The enumeration is the cross product of the machines of the
 * required powered type with those of the required implement type, which is bounded by the
 * garage capacity of GDD section 96 and is therefore small.
 *
 * A combination whose parts are all busy still appears. What never appears is a machine of a
 * type the operation does not take: reserving one would block it for nothing, which is what
 * `IMPLEMENT_NOT_ALLOWED` reports when a request names it anyway.
 */
export function machineCombinations(
  operation: TaskOperation,
  machines: readonly MachineDto[],
): readonly MachineCombination[] {
  const requirement = requirementOf(operation);
  const ownedMachineTypes = machines.map((machine) => machine.type);
  const powered = machines.filter((machine) => machine.type === requirement.poweredMachine);
  const implements_ =
    requirement.requiredImplement === null
      ? []
      : machines.filter((machine) => machine.type === requirement.requiredImplement);

  const rows: MachineCombination[] = [];
  for (const engine of powered) {
    if (requirement.requiredImplement === null) {
      const code = combinationBlockingCode({
        operation,
        powered: engine,
        implement: null,
        ownedMachineTypes,
      });
      rows.push({
        key: engine.id,
        machineIds: [engine.id],
        powered: engine,
        implement: null,
        paceMachine: engine,
        code,
        usable: code === null,
      });
      continue;
    }
    for (const tool of implements_) {
      const code = combinationBlockingCode({
        operation,
        powered: engine,
        implement: tool,
        ownedMachineTypes,
      });
      rows.push({
        key: `${engine.id}+${tool.id}`,
        machineIds: [engine.id, tool.id],
        powered: engine,
        implement: tool,
        // The implement sets the pace when it has a speed of its own (GDD section 91):
        // a worn plow slows the work down behind a new tractor.
        paceMachine: tool,
        code,
        usable: code === null,
      });
    }
  }
  return rows;
}

/**
 * The code for "there is no combination to choose from", which is a different fact from
 * "the combination chosen is refused" and needs its own answer.
 *
 * It reproduces `loadImplement` and the missing machine branch of `checkCompatibility`: a
 * player with no machine of the powered type reads the code that names that type, and one
 * with the engine and no implement reads the implement code. `missingMachineCode` of
 * `shared/rules/machinery.ts` is what turns a type into its code, so the trailer of a
 * harvest and the forwarder of a felling keep their own names.
 */
export function missingMachineryCode(
  operation: TaskOperation,
  machines: readonly MachineDto[],
): ValidationCode | null {
  const requirement = requirementOf(operation);
  const owned = machines.map((machine) => machine.type);
  // The best combination the holding could offer: the required types the player owns at
  // all. What is missing from it is what the table of GDD section 90 will name.
  const offered: MachineType[] = [];
  if (owned.includes(requirement.poweredMachine)) {
    offered.push(requirement.poweredMachine);
  }
  if (requirement.requiredImplement !== null && owned.includes(requirement.requiredImplement)) {
    offered.push(requirement.requiredImplement);
  }
  const codes = explainIncompatibility({
    operation,
    offeredMachineTypes: offered,
    ownedMachineTypes: owned,
  });
  return codes[0] ?? null;
}

// ---------------------------------------------------------------------------
// The target (check 7 of GDD section 104)
// ---------------------------------------------------------------------------

export interface TargetSituation {
  /** Field the operation acts on, when the operation takes one. */
  readonly field: FieldDto | null;
  /** Forest plot the operation acts on, when the operation takes one. */
  readonly plot: ForestPlotDto | null;
  /** Cells the request would carry, for the operations whose target is a selection. */
  readonly selectedCellCount: number;
  /** Standing trees of the selected area whose stage admits felling (GDD section 131). */
  readonly fellableTreeCount: number;
  /** Cells of the plot with no tree, which are the ones replanting fills (GDD section 137). */
  readonly emptyCellCount: number;
}

/**
 * Why the target refuses the operation, in the order of `checkTarget`.
 *
 * The kind of target comes from `OPERATION_REQUIREMENTS.targetKind`, so adding an operation
 * to the catalogue adds it here with no edit. The three kinds refuse for different reasons
 * and none of them is invented: a field refuses by its state (GDD section 76) or by having a
 * task (plan section 5.4), a plot refuses when nothing in the area can be felled (GDD section
 * 131), and a selection refuses when it is empty.
 */
export function targetBlockingCode(
  operation: TaskOperation,
  situation: TargetSituation,
): ValidationCode | null {
  const requirement = requirementOf(operation);
  if (requirement.targetKind === 'FIELD') {
    const field = situation.field;
    if (field === null) {
      return ValidationCode.NOT_FOUND;
    }
    if (field.currentTaskId !== null) {
      return ValidationCode.FIELD_HAS_ACTIVE_TASK;
    }
    if (!requirement.fromCropStates.includes(field.projection.cropCycleState)) {
      return ValidationCode.FIELD_STATE_NOT_ALLOWED;
    }
    return null;
  }
  if (requirement.targetKind === 'FOREST_PLOT') {
    const plot = situation.plot;
    if (plot === null) {
      return ValidationCode.NOT_FOUND;
    }
    if (plot.currentTaskId !== null) {
      return ValidationCode.FIELD_HAS_ACTIVE_TASK;
    }
    if (operation === TaskOperation.FELL) {
      return situation.fellableTreeCount > 0 ? null : ValidationCode.NO_FELLABLE_TREES;
    }
    // Replanting names its cells one by one and they must be empty (GDD section 137).
    if (situation.selectedCellCount <= 0) {
      return situation.emptyCellCount > 0
        ? ValidationCode.SELECTION_EMPTY
        : ValidationCode.CELL_ALREADY_HAS_TREE;
    }
    return null;
  }
  return situation.selectedCellCount > 0 ? null : ValidationCode.SELECTION_EMPTY;
}

/**
 * Units the task would work on, which is the numerator of GDD sections 91 and 135.
 *
 * The cells of the field, the fellable trees of the area, or the size of the selection.
 * Written once because the duration preview, the wood estimate and the warning about the
 * store all divide or multiply by it.
 */
export function unitsForAssignment(operation: TaskOperation, situation: TargetSituation): number {
  const requirement = requirementOf(operation);
  if (requirement.targetKind === 'FIELD') {
    return situation.field?.cellCount ?? 0;
  }
  if (requirement.targetKind === 'FOREST_PLOT') {
    if (operation === TaskOperation.FELL) {
      return situation.fellableTreeCount;
    }
    return situation.selectedCellCount;
  }
  return situation.selectedCellCount;
}

// ---------------------------------------------------------------------------
// The crop (check 8) and the store (check 9)
// ---------------------------------------------------------------------------

/** Why the crop of a sowing is refused, in the order of `checkCrop`. */
export function cropBlockingCode(
  operation: TaskOperation,
  cropId: CropId | null,
): ValidationCode | null {
  const requirement = requirementOf(operation);
  if (!requirement.requiresCrop) {
    return cropId === null ? null : ValidationCode.FIELD_CROP_NOT_ALLOWED;
  }
  if (cropId === null) {
    return ValidationCode.FIELD_CROP_REQUIRED;
  }
  return cropId in CROPS ? null : ValidationCode.CROP_UNKNOWN;
}

export interface StorageSituation {
  /** Whether the destination farm has a store of the resource at all (GDD sections 27 and 136). */
  readonly hasStore: boolean;
  /** Units of the resource the destination can still take. */
  readonly freeUnits: number;
}

/**
 * Why the destination store refuses the operation, in the order of `checkStorage`.
 *
 * Three cases and only two of them refuse. No store and a store with no room are refusals,
 * because both are actionable before the task starts: raise a silo, or sell the grain. A
 * store with *some* room is not a refusal, because GDD sections 83 and 97 waste the excess
 * with a notice and a ledger line rather than rejecting the harvest, and the assignment panel
 * warns about it instead of blocking it.
 */
export function storageBlockingCode(
  operation: TaskOperation,
  situation: StorageSituation | null,
): ValidationCode | null {
  const requirement = requirementOf(operation);
  if (requirement.requiresStorage === null) {
    return null;
  }
  if (situation === null || !situation.hasStore) {
    return ValidationCode.STORAGE_REQUIRED;
  }
  if (situation.freeUnits > 0) {
    return null;
  }
  return requirement.requiresStorage === StorageResource.WHEAT_LITERS
    ? ValidationCode.SILO_CAPACITY_EXCEEDED
    : ValidationCode.WOOD_STORAGE_CAPACITY_EXCEEDED;
}

// ---------------------------------------------------------------------------
// The whole sequence
// ---------------------------------------------------------------------------

export interface AssignmentSituation {
  readonly operation: TaskOperation;
  readonly worker: WorkerDto | null;
  readonly combination: MachineCombination | null;
  /** Every machine of the holding, for the "there is nothing to choose" answer. */
  readonly machines: readonly MachineDto[];
  readonly target: TargetSituation;
  readonly cropId: CropId | null;
  readonly storage: StorageSituation | null;
}

/**
 * The first reason the server would refuse the assignment, or null when it would accept it.
 *
 * This is the function the submit button reads, and its order is the order of
 * `evaluateAssignment`. Nothing chooses "the most informative" reason: any criterion other
 * than the one of the server produces the loop ADR-0048 exists to break, where the player
 * fixes what he was told and the button stays grey.
 */
export function assignmentBlockingCode(situation: AssignmentSituation): ValidationCode | null {
  // 1. The worker.
  if (situation.worker === null) {
    return ValidationCode.WORKER_NOT_IDLE;
  }
  const workerCode = workerBlockingCode(
    situation.worker,
    situation.combination?.powered.farmId ?? null,
  );
  // The farm check is check 6 and is applied below, after the machinery, so only the
  // status refuses here.
  if (workerCode === ValidationCode.WORKER_NOT_IDLE) {
    return workerCode;
  }

  // 2 to 5. The machinery, with the whole combination judged in the server order.
  if (situation.combination === null) {
    return missingMachineryCode(situation.operation, situation.machines);
  }
  if (situation.combination.code !== null) {
    return situation.combination.code;
  }

  // 6. Worker and machinery of the same farm (GDD section 108).
  if (workerCode !== null) {
    return workerCode;
  }

  // 7, 8 and 9.
  const targetCode = targetBlockingCode(situation.operation, situation.target);
  if (targetCode !== null) {
    return targetCode;
  }
  const cropCode = cropBlockingCode(situation.operation, situation.cropId);
  if (cropCode !== null) {
    return cropCode;
  }
  return storageBlockingCode(situation.operation, situation.storage);
}

/**
 * The unit an operation is measured in, as the interface names it.
 *
 * Taken from `OPERATION_REQUIREMENTS.workUnit` so that a felling counts trees and everything
 * else counts cells without the panel deciding it.
 */
export function unitLabel(operation: TaskOperation, count: number): string {
  const requirement = requirementOf(operation);
  if (requirement.workUnit === 'TREES') {
    return count === 1 ? 'arbol' : 'arboles';
  }
  return count === 1 ? 'celda' : 'celdas';
}

/** Machine types an operation reserves, for the heading of the selector (GDD section 90). */
export function reservedMachineTypes(operation: TaskOperation): readonly MachineType[] {
  const requirement = requirementOf(operation);
  return requirement.requiredImplement === null
    ? [requirement.poweredMachine]
    : [requirement.poweredMachine, requirement.requiredImplement];
}

/** Whether a machine of the holding is busy, for the note next to a greyed row. */
export function isMachineBusy(machine: MachineDto): boolean {
  return machine.status !== MachineStatus.IDLE || machine.currentTaskId !== null;
}

/** Catalogue definition of a machine, so no panel writes a price or a speed. */
export function catalogueOf(type: MachineType): MachineDefinition {
  return MACHINE_CATALOGUE[type];
}
