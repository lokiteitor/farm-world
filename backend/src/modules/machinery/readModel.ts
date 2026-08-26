// The read models of the `machinery` area: the machine and the catalogue.
//
// Owner: workflow W5-A. Module `machinery`.
//
// One builder per entity of the contract, used by the routes and by the frames they emit
// alike. That is the requirement of ADR-0006 and not tidiness: every entity of a mutating
// reply is a complete replacement rather than a delta, so the reply of `POST /api/machines`
// and the `MACHINE_UPSERTED` frame it produces have to be the same object, or the client
// would converge to a different state depending on which of the two arrived first.
//
// The machine carries no price, no work speed and no capacity: those are catalogue data
// indexed by type (plan section 5.2), and both sides import the same catalogue from
// `shared/config`. What travels instead are the three derived figures the panels need, and
// all three come from the shared rules rather than from arithmetic written here:
//
//   `resaleValue`             `machineResaleValue` of shared/rules/pricing.ts
//   `repairCost`              `repairCost` of shared/rules/machinery.ts (GDD section 93)
//   `repairDurationGameHours` `repairDurationGameHours` of the same module
//
// Both repair figures describe a full restoration, which is what the button offers by
// default; a partial repair is priced by the same rule evaluated at the target.
//
// `GET /api/machines/catalog` exists for three consumers that cannot read TypeScript: the
// OpenAPI document, the simulated server of the client and any external tool. It is not how
// the client learns the catalogue, which it imports (shared/api/schemas/machinery.ts).

import {
  CONDITION_WARNING_THRESHOLD,
  GameEventType,
  MACHINE_CATALOGUE,
  MACHINE_TYPES,
  MIN_CONDITION_TO_ASSIGN,
  OPERATION_REQUIREMENTS,
  TASK_OPERATIONS,
  repairCost,
  repairDurationGameHours,
  toWireGameMs,
  toWireMoney,
  type MachineCatalogEntry,
  type MachineCatalogReply,
  type MachineDto,
  type MachineType,
  type MachineUpsertedPayload,
  type OperationRequirementDto,
  type TaskOperation,
} from '../../shared/index.js';
import { definitionOf, isAssignable, resaleValueOf, type MachineRecord } from './record.js';

/** A machine as the contract carries it. */
export function toMachineDto(machine: MachineRecord): MachineDto {
  const definition = definitionOf(machine.type);
  return {
    id: machine.id,
    farmId: machine.farmId,
    garageId: machine.garageId,
    type: machine.type,
    conditionBp: machine.conditionBp,
    conditionUpdatedAtGameMs: toWireGameMs(machine.conditionUpdatedAtGameMs),
    status: machine.status,
    currentTaskId: machine.currentTaskId,
    repairEndsAtGameMs:
      machine.repairEndsAtGameMs === null ? null : toWireGameMs(machine.repairEndsAtGameMs),
    purchasePrice: toWireMoney(machine.purchasePrice),
    acquiredGameMs: toWireGameMs(machine.acquiredGameMs),
    resaleValue: toWireMoney(resaleValueOf(machine)),
    repairCost: toWireMoney(repairCost(machine.conditionBp, definition)),
    repairDurationGameHours: repairDurationGameHours(machine.conditionBp),
    assignable: isAssignable(machine),
  };
}

/**
 * The frame every write of this module emits for the machine it touched.
 *
 * The same builder the replies use, which is what ADR-0006 requires: a client that applies
 * the frame and a client that applies the reply have to reach the same row.
 */
export function machineUpsertedFrame(machine: MachineRecord): {
  readonly type: typeof GameEventType.MACHINE_UPSERTED;
  readonly payload: MachineUpsertedPayload;
} {
  return { type: GameEventType.MACHINE_UPSERTED, payload: { machine: toMachineDto(machine) } };
}

/** One entry of the catalogue of GDD sections 89 and 134, as it travels. */
function toCatalogEntry(type: MachineType): MachineCatalogEntry {
  const definition = MACHINE_CATALOGUE[type];
  return {
    type: definition.type,
    role: definition.role,
    purchasePrice: toWireMoney(definition.purchasePrice),
    maintenanceCostPerGameHour: toWireMoney(definition.maintenanceCostPerGameHour),
    operatingCostPerGameHour: toWireMoney(definition.operatingCostPerGameHour),
    workSpeedUnitsPerGameHour: definition.workSpeedUnitsPerGameHour,
    workUnit: definition.workUnit,
    workWidthM: definition.workWidthM,
    capacity: definition.capacity,
    capacityResource: definition.capacityResource,
    wearRateBpPerGameHour: definition.wearRateBpPerGameHour,
    repairCostPerConditionPoint: toWireMoney(definition.repairCostPerConditionPoint),
    compatibleImplements: [...definition.compatibleImplements],
  };
}

/** One row of the compatibility table of GDD section 90, as it travels. */
function toOperationRequirementDto(operation: TaskOperation): OperationRequirementDto {
  const requirement = OPERATION_REQUIREMENTS[operation];
  return {
    operation: requirement.operation,
    targetKind: requirement.targetKind,
    workUnit: requirement.workUnit,
    poweredMachine: requirement.poweredMachine,
    requiredImplement: requirement.requiredImplement,
    requiredPossession: [...requirement.requiredPossession],
    requiresCrop: requirement.requiresCrop,
    // `FROM_CROP` is a sentinel of the requirement table, not a storage category: the
    // catalogue route reports null, because the category the operation ends up using is
    // decided by the crop on the field and is not a property of the operation.
    requiresStorage:
      requirement.requiresStorage === 'FROM_CROP' ? null : requirement.requiresStorage,
    /** Whether the store this operation needs depends on the crop being worked. */
    storageFromCrop: requirement.requiresStorage === 'FROM_CROP',
  };
}

/** The whole `GET /api/machines/catalog` reply. Pure: it reads no row at all. */
export function buildCatalogReply(): MachineCatalogReply {
  return {
    machines: MACHINE_TYPES.map(toCatalogEntry),
    operations: TASK_OPERATIONS.map(toOperationRequirementDto),
    minConditionToAssignBp: MIN_CONDITION_TO_ASSIGN,
    conditionWarningThresholdBp: CONDITION_WARNING_THRESHOLD,
  };
}
