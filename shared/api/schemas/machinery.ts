// Machinery area: the holding, the catalogue and repair.
//
// Owner: workflow W2 (API contract).
//
// The machine carries no price, no work speed and no capacity: those are catalogue
// data indexed by type (plan section 5.2), and both sides import the same catalogue
// from shared/config. What the reply does carry is the price actually paid, because a
// historical row must stay auditable after a catalogue change, and the derived
// figures the panels need: what a resale would return, what a full repair would cost,
// and the effective work speed the current condition yields.
//
// `assignedWorkerId` of GDD section 98 does not exist: the authoritative link between
// a worker and a machine is the task (plan section 5.2). `currentTaskId` does exist,
// and it is the reservation column the conditional update writes to rule out a double
// booking.

import { z } from 'zod';
import {
  MachineRole,
  MachineStatus,
  MachineType,
  StorageResource,
  TaskOperation,
} from '../../domain/enums.js';
import {
  bpSchema,
  buildingIdSchema,
  countSchema,
  farmIdSchema,
  gameHoursSchema,
  gameMsSchema,
  machineIdSchema,
  moneySchema,
  storageUnitsSchema,
  taskIdSchema,
} from './common.js';

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export const machineDtoSchema = z.strictObject({
  id: machineIdSchema,
  /** Ownership. Mandatory, unlike the ambiguous `location` of GDD section 98. */
  farmId: farmIdSchema,
  /** Physical location. Assigned by the server so that capacity is checked per building. */
  garageId: buildingIdSchema.nullable(),
  type: z.enum(MachineType),
  conditionBp: bpSchema,
  /** Instant the condition was last settled at. Wear applies per hour worked (GDD 93). */
  conditionUpdatedAtGameMs: gameMsSchema,
  status: z.enum(MachineStatus),
  currentTaskId: taskIdSchema.nullable(),
  /** Instant a scheduled repair completes, for the countdown of the interface. */
  repairEndsAtGameMs: gameMsSchema.nullable(),
  purchasePrice: moneySchema,
  acquiredGameMs: gameMsSchema,
  /** Derived: what a sale would return at the current condition (plan section 6.6). */
  resaleValue: moneySchema,
  /** Derived: cost and duration of restoring the condition to full (GDD section 93). */
  repairCost: moneySchema,
  repairDurationGameHours: gameHoursSchema,
  /** Derived: whether the condition is above the minimum to be assigned to a task. */
  assignable: z.boolean(),
});
export type MachineDto = z.infer<typeof machineDtoSchema>;

export const machinesReplySchema = z.strictObject({
  machines: z.array(machineDtoSchema),
});
export type MachinesReply = z.infer<typeof machinesReplySchema>;

export const machineParamsSchema = z.strictObject({ machineId: machineIdSchema });
export type MachineParams = z.infer<typeof machineParamsSchema>;

// ---------------------------------------------------------------------------
// GET /api/machines/catalog
// ---------------------------------------------------------------------------
//
// The catalogue is a constant of shared/config that both sides already import, so
// this route is not how the client learns it. It exists for three other consumers:
// the OpenAPI documentation, which must describe the balance figures without reading
// TypeScript; the simulated server, which serves them unchanged; and any external
// tool. Money is a decimal string here too, so the route is not a second
// serialisation convention.

export const machineCatalogEntrySchema = z.strictObject({
  type: z.enum(MachineType),
  role: z.enum(MachineRole),
  purchasePrice: moneySchema,
  maintenanceCostPerGameHour: moneySchema,
  operatingCostPerGameHour: moneySchema,
  workSpeedUnitsPerGameHour: z.number().positive().nullable(),
  workUnit: z.enum(['CELLS', 'TREES']).nullable(),
  workWidthM: z.number().positive().nullable(),
  capacity: storageUnitsSchema.nullable(),
  capacityResource: z.enum(StorageResource).nullable(),
  wearRateBpPerGameHour: bpSchema,
  repairCostPerConditionPoint: moneySchema,
  compatibleImplements: z.array(z.enum(MachineType)),
});
export type MachineCatalogEntry = z.infer<typeof machineCatalogEntrySchema>;

/** One row of the compatibility table of GDD section 90, as it travels. */
export const operationRequirementSchema = z.strictObject({
  operation: z.enum(TaskOperation),
  targetKind: z.enum(['FIELD', 'FOREST_PLOT', 'CELLS']),
  workUnit: z.enum(['CELLS', 'TREES']),
  poweredMachine: z.enum(MachineType),
  requiredImplement: z.enum(MachineType).nullable(),
  requiredPossession: z.array(z.enum(MachineType)),
  requiresCrop: z.boolean(),
  /**
   * Storage category the operation deposits into, or null.
   *
   * Null for a harvest as well, and that is not an omission: the category a harvest needs
   * is the one of the crop standing on the field, so it is not a property of the operation
   * at all. `storageFromCrop` is what says so.
   */
  requiresStorage: z.enum(StorageResource).nullable(),
  /** Whether the store this operation needs is decided by the crop being worked. */
  storageFromCrop: z.boolean(),
});
export type OperationRequirementDto = z.infer<typeof operationRequirementSchema>;

export const machineCatalogReplySchema = z.strictObject({
  machines: z.array(machineCatalogEntrySchema),
  operations: z.array(operationRequirementSchema),
  /** Minimum condition to assign a machine, and the threshold the interface warns at. */
  minConditionToAssignBp: bpSchema,
  conditionWarningThresholdBp: bpSchema,
});
export type MachineCatalogReply = z.infer<typeof machineCatalogReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/machines
// ---------------------------------------------------------------------------

/**
 * Buying a machine requires a free garage slot (GDD section 96). The slot is checked
 * by a counter with a database constraint, so two concurrent purchases with one slot
 * left cannot both succeed (plan section 5.4). `garageId` may be omitted, in which
 * case the server picks the first garage of the farm with room; naming it is what the
 * interface does when the player has more than one.
 */
export const buyMachineBodySchema = z.strictObject({
  farmId: farmIdSchema,
  type: z.enum(MachineType),
  garageId: buildingIdSchema.optional(),
  expectedTotal: moneySchema.optional(),
});
export type BuyMachineBody = z.infer<typeof buyMachineBodySchema>;

export const buyMachineResultSchema = z.strictObject({
  machine: machineDtoSchema,
  totalPaid: moneySchema,
  balanceAfter: moneySchema,
  /** Garage occupancy after the purchase, so the panel can grey the button out. */
  garageSlotsUsed: countSchema,
  garageSlotsTotal: countSchema,
});
export type BuyMachineResult = z.infer<typeof buyMachineResultSchema>;

// ---------------------------------------------------------------------------
// POST /api/machines/:machineId/sell
// ---------------------------------------------------------------------------

export const sellMachineResultSchema = z.strictObject({
  machineId: machineIdSchema,
  refund: moneySchema,
  balanceAfter: moneySchema,
  garageSlotsUsed: countSchema,
  garageSlotsTotal: countSchema,
});
export type SellMachineResult = z.infer<typeof sellMachineResultSchema>;

// ---------------------------------------------------------------------------
// POST /api/machines/:machineId/repair
// ---------------------------------------------------------------------------

/**
 * Repair is a scheduled event with a duration proportional to the points restored,
 * it requires a workshop on the farm and it puts the machine in `IN_REPAIR` (plan
 * section 2.2, resolution of GDD sections 29, 93, 95 and 117). It consumes no worker.
 *
 * `toConditionBp` allows a partial repair, which is what makes the decision a
 * cash flow decision and not a binary one; omitted means restore to full.
 */
export const repairMachineBodySchema = z.strictObject({
  toConditionBp: bpSchema.optional(),
  expectedTotal: moneySchema.optional(),
});
export type RepairMachineBody = z.infer<typeof repairMachineBodySchema>;

export const repairMachineResultSchema = z.strictObject({
  machine: machineDtoSchema,
  pointsRestored: z.number().int().positive(),
  totalPaid: moneySchema,
  balanceAfter: moneySchema,
  repairEndsAtGameMs: gameMsSchema,
});
export type RepairMachineResult = z.infer<typeof repairMachineResultSchema>;
