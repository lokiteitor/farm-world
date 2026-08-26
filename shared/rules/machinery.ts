// Machinery: wear, repair and the compatibility table of GDD section 90.
//
// Owner: workflow W2 (pure rules).
//
// The compatibility rule lives here and only here, as plan section 5.4 requires:
// the server validates a task against it before creating anything, and the client
// uses the same function to say why a combination is greyed out. Duplicating the
// rule in two languages is exactly how the green highlight and the 400 come to
// disagree.
//
// The reasons are returned as `ValidationCode` values rather than as prose, so that
// the REST error body, the message table of shared/domain and the client all name
// the same rule.

import {
  MACHINE_CATALOGUE,
  MIN_CONDITION_TO_ASSIGN,
  OPERATION_REQUIREMENTS,
  REPAIR_GAME_HOURS_PER_CONDITION_POINT,
  type MachineDefinition,
  type OperationRequirement,
} from '../config/machines.js';
import {
  MachineStatus,
  MachineType,
  ValidationCode,
  type CropId,
  type MachineRole,
  type StockItem,
  type StorageResource,
  type TaskOperation,
} from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { BP_ONE, clampBp, gameHours, type Bp, type GameHours } from '../domain/units.js';

// ---------------------------------------------------------------------------
// Wear and repair
// ---------------------------------------------------------------------------

/**
 * Condition after a number of game hours worked (GDD section 93). Degradation while
 * idle is explicitly outside the MVP (GDD sections 93 and 99), so only hours worked
 * count, and a cancelled task applies the wear of the hours it actually ran (plan
 * section 2.2, resolution of GDD sections 106 and 111).
 *
 * The wear rate itself is an invented value: GDD section 93 requires
 * `wearRatePerHour` but never defines it. The figures live in the catalogue with
 * their justification.
 */
export function conditionAfterWork(
  conditionBp: Bp,
  gameHoursWorked: number,
  definition: MachineDefinition,
): Bp {
  const hours = gameHoursWorked > 0 ? gameHoursWorked : 0;
  const wear = Math.round(definition.wearRateBpPerGameHour * hours);
  return clampBp(conditionBp - wear);
}

/** Condition points still to be restored, in the 0..100 scale of GDD section 93. */
export function conditionPointsToRestore(conditionBp: Bp): number {
  const missing = BP_ONE - conditionBp;
  return missing > 0 ? missing / 100 : 0;
}

/**
 * Cost of a repair (GDD section 93): `(100 - condition) x repairCostPerPoint`. The
 * rate per point is a fraction of the purchase price, stated in the catalogue.
 */
export function repairCost(conditionBp: Bp, definition: MachineDefinition): Money {
  return Money.mulRatio(
    definition.repairCostPerConditionPoint,
    conditionPointsToRestore(conditionBp),
  );
}

/**
 * Duration of a repair, in game hours. GDD section 93 gives repair no duration at
 * all; plan section 2.2 turns it into a scheduled event whose length is proportional
 * to the points restored, which is what makes `IN_REPAIR` a real state instead of a
 * reserved one.
 */
export function repairDurationGameHours(
  conditionBp: Bp,
  gameHoursPerPoint: GameHours = REPAIR_GAME_HOURS_PER_CONDITION_POINT,
): GameHours {
  return gameHours(conditionPointsToRestore(conditionBp) * gameHoursPerPoint);
}

// ---------------------------------------------------------------------------
// Assignment and repair preconditions
// ---------------------------------------------------------------------------

/** The part of a machine the pure rules need in order to judge it. */
export interface MachineView {
  readonly type: MachineType;
  readonly conditionBp: Bp;
  readonly status: MachineStatus;
}

/**
 * Whether a machine may be reserved by a task. Returns the code of the rule that is
 * not met, or null when the machine may be assigned.
 *
 * The condition floor is a decision of plan section 2.2: GDD section 91 says nothing
 * below 10 % and the condition curve is clamped there, so accepting a machine below
 * that point would mean extrapolating a balance number.
 */
export function canAssignMachine(
  machine: MachineView,
  minConditionBp: Bp = MIN_CONDITION_TO_ASSIGN,
): ValidationCode | null {
  if (machine.status !== MachineStatus.IDLE) {
    return ValidationCode.MACHINE_NOT_IDLE;
  }
  if (machine.conditionBp < minConditionBp) {
    return ValidationCode.MACHINE_CONDITION_TOO_LOW;
  }
  return null;
}

/**
 * Whether a machine may be sent for repair (GDD sections 29 and 93). A workshop is
 * required, the machine must be idle, and a machine already at full condition has
 * nothing to repair.
 */
export function canRepairMachine(
  machine: MachineView,
  farmHasWorkshop: boolean,
): ValidationCode | null {
  if (!farmHasWorkshop) {
    return ValidationCode.WORKSHOP_REQUIRED;
  }
  if (machine.conditionBp >= BP_ONE) {
    return ValidationCode.MACHINE_CONDITION_ALREADY_FULL;
  }
  if (machine.status === MachineStatus.IN_REPAIR || machine.status === MachineStatus.WORKING) {
    return ValidationCode.MACHINE_NOT_REPAIRABLE;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compatibility of operation and machinery (GDD section 90)
// ---------------------------------------------------------------------------

export interface OperationCompatibilityInput {
  readonly operation: TaskOperation;
  /** Types of the machines the task would reserve, in any order. */
  readonly offeredMachineTypes: readonly MachineType[];
  /**
   * Types the player owns and that the task does not reserve. Used for the
   * possession requirements, such as the forwarder of GDD section 134, which is an
   * ownership requirement in the MVP and not an active transport restriction.
   */
  readonly ownedMachineTypes: readonly MachineType[];
  /**
   * Type the caller named as the powered machine, when the caller knows the role.
   *
   * GDD section 90 is a table of roles and not a bag of types: `PLOW` is "tractor plus
   * plough", never "plough plus tractor". Without this the two are indistinguishable,
   * because the multiset of types is the same, and the server would accept a request
   * whose roles are swapped. Optional so that a caller with no roles to offer — the
   * panel asking "what is missing from this holding" — keeps working unchanged.
   */
  readonly poweredMachineType?: MachineType | null | undefined;
  /** Type the caller named as the implement, under the same rule. */
  readonly implementMachineType?: MachineType | null | undefined;
}

export interface CompatibilityOptions {
  readonly catalogue?: Readonly<Record<MachineType, MachineDefinition>>;
  readonly requirements?: Readonly<Record<TaskOperation, OperationRequirement>>;
}

/** The code that names a missing machine of a given type as precisely as possible. */
function missingMachineCode(type: MachineType, role: MachineRole): ValidationCode {
  if (type === MachineType.TRAILER) {
    return ValidationCode.TRAILER_REQUIRED;
  }
  if (type === MachineType.FORWARDER) {
    return ValidationCode.FORWARDER_REQUIRED;
  }
  return role === 'POWERED'
    ? ValidationCode.POWERED_MACHINE_REQUIRED
    : ValidationCode.IMPLEMENT_REQUIRED;
}

/**
 * Every rule of GDD section 90 that the proposed combination fails, in a stable
 * order and without duplicates.
 *
 * The checks, in order: the operation exists in the table; each machine whose role the
 * caller named carries the type that role demands; the powered machine it requires is
 * offered; the implement it requires is offered; the implement can actually be towed by
 * that powered machine (GDD sections 88 and 89); nothing superfluous is offered, because
 * reserving a machine a task does not need would block it for no reason; and every
 * possession requirement is owned.
 */
export function explainIncompatibility(
  input: OperationCompatibilityInput,
  options: CompatibilityOptions = {},
): readonly ValidationCode[] {
  const requirements = options.requirements ?? OPERATION_REQUIREMENTS;
  const catalogue = options.catalogue ?? MACHINE_CATALOGUE;
  const requirement = requirements[input.operation] as OperationRequirement | undefined;
  if (requirement === undefined) {
    return [ValidationCode.OPERATION_NOT_SUPPORTED];
  }

  const codes: ValidationCode[] = [];
  const add = (code: ValidationCode): void => {
    if (!codes.includes(code)) {
      codes.push(code);
    }
  };

  const offered = [...input.offeredMachineTypes];
  const take = (type: MachineType): boolean => {
    const index = offered.indexOf(type);
    if (index === -1) {
      return false;
    }
    offered.splice(index, 1);
    return true;
  };

  // The roles, when the caller knows them, before the counting. A request that names the
  // implement as the powered machine and the powered machine as the implement offers the
  // right multiset of types and the wrong table row, and the table of GDD section 90 is
  // written by role.
  if (
    input.poweredMachineType !== undefined &&
    input.poweredMachineType !== null &&
    input.poweredMachineType !== requirement.poweredMachine
  ) {
    add(ValidationCode.POWERED_MACHINE_REQUIRED);
  }
  if (input.implementMachineType !== undefined && input.implementMachineType !== null) {
    if (requirement.requiredImplement === null) {
      add(ValidationCode.IMPLEMENT_NOT_ALLOWED);
    } else if (input.implementMachineType !== requirement.requiredImplement) {
      add(
        input.implementMachineType === requirement.poweredMachine
          ? ValidationCode.IMPLEMENT_NOT_ALLOWED
          : missingMachineCode(
              requirement.requiredImplement,
              catalogue[requirement.requiredImplement].role,
            ),
      );
    }
  }

  const powered = catalogue[requirement.poweredMachine];
  if (!take(requirement.poweredMachine)) {
    add(missingMachineCode(requirement.poweredMachine, powered.role));
  }

  if (requirement.requiredImplement !== null) {
    const implement = catalogue[requirement.requiredImplement];
    if (!take(requirement.requiredImplement)) {
      add(missingMachineCode(requirement.requiredImplement, implement.role));
    } else if (!powered.compatibleImplements.includes(requirement.requiredImplement)) {
      add(ValidationCode.MACHINE_TYPE_NOT_COMPATIBLE);
    }
  }

  for (const extra of offered) {
    add(
      catalogue[extra].role === 'IMPLEMENT'
        ? ValidationCode.IMPLEMENT_NOT_ALLOWED
        : ValidationCode.MACHINE_TYPE_NOT_COMPATIBLE,
    );
  }

  for (const possessed of requirement.requiredPossession) {
    const owned =
      input.ownedMachineTypes.includes(possessed) || input.offeredMachineTypes.includes(possessed);
    if (!owned) {
      add(missingMachineCode(possessed, catalogue[possessed].role));
    }
  }

  return codes;
}

/** Whether a combination of machines can carry out an operation (GDD section 90). */
export function isOperationCompatible(
  input: OperationCompatibilityInput,
  options: CompatibilityOptions = {},
): boolean {
  return explainIncompatibility(input, options).length === 0;
}

/**
 * Machine types an operation needs to reserve, which is what the interface offers
 * the player to pick from.
 */
export function machineTypesForOperation(
  operation: TaskOperation,
  requirements: Readonly<Record<TaskOperation, OperationRequirement>> = OPERATION_REQUIREMENTS,
): readonly MachineType[] {
  const requirement = requirements[operation];
  return requirement.requiredImplement === null
    ? [requirement.poweredMachine]
    : [requirement.poweredMachine, requirement.requiredImplement];
}

// ---------------------------------------------------------------------------
// Storage target of an operation
// ---------------------------------------------------------------------------

/**
 * Storage category an operation deposits into, and the pile it deposits into.
 *
 * The single place that resolves the `FROM_CROP` sentinel of `OPERATION_REQUIREMENTS`.
 * Harvesting names no crop in its request (the field already carries one), so the
 * category cannot be a constant of the operation: the caller passes the crop standing
 * on the field and gets back both the bucket that has to have room and the pile the
 * litres land in.
 *
 * Returns null when the operation stores nothing, and null as well when the operation
 * needs a crop to know and none was given, which is a caller error the validation layer
 * reports as `FIELD_CROP_REQUIRED` rather than something this function can decide.
 */
export function storageTargetOf(
  operation: TaskOperation,
  cropId: CropId | null,
  crops: Readonly<Record<CropId, { readonly storageResource: StorageResource }>>,
  requirements: Readonly<Record<TaskOperation, OperationRequirement>> = OPERATION_REQUIREMENTS,
): { readonly category: StorageResource; readonly item: StockItem } | null {
  const required = requirements[operation]?.requiresStorage ?? null;
  if (required === null) {
    return null;
  }
  if (required !== 'FROM_CROP') {
    // Timber is the one fixed category left, and its pile is the resource itself.
    return { category: required, item: 'WOOD' };
  }
  if (cropId === null) {
    return null;
  }
  return { category: crops[cropId].storageResource, item: cropId };
}
