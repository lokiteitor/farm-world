// Tasks area: the assignment of a worker and machinery to an operation.
//
// Owner: workflow W2 (API contract).
//
// The request is a discriminated union over the operation, and not one object with
// every field optional. The reason is that the six checks of GDD section 104 and the
// compatibility table of GDD section 90 are about which fields must be present: a
// sowing without a crop, a felling with a field as its target or a clearing without
// cells are malformed requests, not domain conflicts, and the schema is where that
// distinction belongs. A combination that the schema accepts still has to pass the
// domain checks, which is where the state of the field, the reservation of the machines
// and the storage capacity are decided.
//
// Division of the routes. `POST /api/tasks` accepts the four agricultural operations;
// the three forestry operations have their own routes in the forestry area, which is
// how plan section 7 lists them. `POST /api/tasks/estimate` accepts all seven, because
// it computes and mutates nothing.

import { z } from 'zod';
import { CropId, TaskOperation, TaskStatus } from '../../domain/enums.js';
import { apiErrorSchema } from '../errors.js';
import {
  cellSelectionSchema,
  countSchema,
  cursorSchema,
  DEFAULT_LIST_PAGE,
  farmIdSchema,
  fieldIdSchema,
  forestPlotIdSchema,
  gameHoursSchema,
  gameMsSchema,
  limitQuerySchema,
  machineIdSchema,
  MAX_LIST_PAGE,
  moneySchema,
  storageUnitsSchema,
  taskIdSchema,
  workerIdSchema,
} from './common.js';

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export const taskDtoSchema = z.strictObject({
  id: taskIdSchema,
  workerId: workerIdSchema,
  /** Machines the task reserves. The powered machine first, then its implement. */
  machineIds: z.array(machineIdSchema).min(1),
  operation: z.enum(TaskOperation),
  status: z.enum(TaskStatus),
  targetFieldId: fieldIdSchema.nullable(),
  targetForestPlotId: forestPlotIdSchema.nullable(),
  /** Farm whose storage receives the produce. Null for operations that produce nothing. */
  destinationFarmId: farmIdSchema.nullable(),
  cropId: z.enum(CropId).nullable(),
  /** Cells or trees when the task started. Audit, and the divisor of the duration. */
  unitsAtStart: countSchema,
  /** Effective work speed in thousandths of a unit per game hour (GDD section 91). */
  effectiveWorkSpeedMilli: z.number().int().positive(),
  /** Storage reserved on assignment, in the stored unit of the resource. */
  reservedStorageUnits: storageUnitsSchema.nullable(),
  startGameMs: gameMsSchema,
  scheduledEndGameMs: gameMsSchema,
  /** Real end. Differs from the scheduled end when the task was cancelled. */
  endedGameMs: gameMsSchema.nullable(),
  cancelable: z.boolean(),
  /** Derived: elapsed fraction of the scheduled duration at the clock of the reply. */
  progressBp: z.number().int().min(0).max(10_000),
});
export type TaskDto = z.infer<typeof taskDtoSchema>;

export const tasksQuerySchema = z.strictObject({
  status: z.enum(TaskStatus).optional(),
  limit: limitQuerySchema(MAX_LIST_PAGE, DEFAULT_LIST_PAGE),
  cursor: cursorSchema.optional(),
});
export type TasksQuery = z.infer<typeof tasksQuerySchema>;

export const tasksReplySchema = z.strictObject({
  tasks: z.array(taskDtoSchema),
  nextCursor: cursorSchema.nullable(),
  atGameMs: gameMsSchema,
});
export type TasksReply = z.infer<typeof tasksReplySchema>;

export const taskParamsSchema = z.strictObject({ taskId: taskIdSchema });
export type TaskParams = z.infer<typeof taskParamsSchema>;

export const taskDetailReplySchema = z.strictObject({
  task: taskDtoSchema,
  atGameMs: gameMsSchema,
});
export type TaskDetailReply = z.infer<typeof taskDetailReplySchema>;

// ---------------------------------------------------------------------------
// The request, per operation
// ---------------------------------------------------------------------------

const commonAssignment = {
  workerId: workerIdSchema,
  /** The self propelled machine (GDD section 88). Reserved by the task. */
  poweredMachineId: machineIdSchema,
};

/** `VIRGIN -> PLOWED`. Tractor and plow (GDD section 90). */
export const plowTaskRequestSchema = z.strictObject({
  operation: z.literal(TaskOperation.PLOW),
  ...commonAssignment,
  implementMachineId: machineIdSchema,
  targetFieldId: fieldIdSchema,
});

/** `PLOWED -> CULTIVATED`. Tractor and cultivator, and it resets the weed level. */
export const cultivateTaskRequestSchema = z.strictObject({
  operation: z.literal(TaskOperation.CULTIVATE),
  ...commonAssignment,
  implementMachineId: machineIdSchema,
  targetFieldId: fieldIdSchema,
});

/** `CULTIVATED/PLOWED -> SEEDED`. Tractor and seeder, and the crop is mandatory. */
export const seedTaskRequestSchema = z.strictObject({
  operation: z.literal(TaskOperation.SEED),
  ...commonAssignment,
  implementMachineId: machineIdSchema,
  targetFieldId: fieldIdSchema,
  cropId: z.enum(CropId),
});

/**
 * `READY_TO_HARVEST -> HARVESTED`. Combine and trailer, and a destination farm whose
 * silo has room: the capacity is reserved on assignment so that an overflow is an
 * actionable rejection and not a silent loss (plan section 5.4).
 */
export const harvestTaskRequestSchema = z.strictObject({
  operation: z.literal(TaskOperation.HARVEST),
  ...commonAssignment,
  implementMachineId: machineIdSchema,
  targetFieldId: fieldIdSchema,
  destinationFarmId: farmIdSchema,
});

/**
 * Batch felling (GDD section 132, option B). `cells` restricts the batch to a
 * sub area of the plot; omitted means the whole plot. Only trees whose stage is
 * fellable are counted (GDD section 131).
 */
export const fellTaskRequestSchema = z.strictObject({
  operation: z.literal(TaskOperation.FELL),
  ...commonAssignment,
  targetForestPlotId: forestPlotIdSchema,
  cells: cellSelectionSchema.shape.cells.optional(),
  destinationFarmId: farmIdSchema,
});

/** Replanting (GDD section 137). One sapling per named empty cell of the plot. */
export const replantTaskRequestSchema = z.strictObject({
  operation: z.literal(TaskOperation.REPLANT),
  ...commonAssignment,
  targetForestPlotId: forestPlotIdSchema,
  cells: cellSelectionSchema.shape.cells,
});

/**
 * Clearing felled forest into arable land (GDD section 10). Tractor and plow, and the
 * cells must be empty of standing trees. `forestPlotId` is optional and only says
 * which plot the cells are leaving, when they belong to one.
 */
export const clearLandTaskRequestSchema = z.strictObject({
  operation: z.literal(TaskOperation.CLEAR_LAND),
  ...commonAssignment,
  implementMachineId: machineIdSchema,
  cells: cellSelectionSchema.shape.cells,
  forestPlotId: forestPlotIdSchema.optional(),
});

/** The four operations `POST /api/tasks` accepts. */
export const agriculturalTaskRequestSchema = z.discriminatedUnion('operation', [
  plowTaskRequestSchema,
  cultivateTaskRequestSchema,
  seedTaskRequestSchema,
  harvestTaskRequestSchema,
]);
export type AgriculturalTaskRequest = z.infer<typeof agriculturalTaskRequestSchema>;

/** The three operations the forestry routes accept. */
export const forestryTaskRequestSchema = z.discriminatedUnion('operation', [
  fellTaskRequestSchema,
  replantTaskRequestSchema,
  clearLandTaskRequestSchema,
]);
export type ForestryTaskRequest = z.infer<typeof forestryTaskRequestSchema>;

/** All seven operations. Accepted by the estimate, which mutates nothing. */
export const taskRequestSchema = z.discriminatedUnion('operation', [
  plowTaskRequestSchema,
  cultivateTaskRequestSchema,
  seedTaskRequestSchema,
  harvestTaskRequestSchema,
  fellTaskRequestSchema,
  replantTaskRequestSchema,
  clearLandTaskRequestSchema,
]);
export type TaskRequest = z.infer<typeof taskRequestSchema>;

// ---------------------------------------------------------------------------
// POST /api/tasks/estimate
// ---------------------------------------------------------------------------

/**
 * The estimate answers the two questions the assignment panel asks before it enables
 * its button: how long the task would take and what it would cost, and if it is not
 * possible, exactly why.
 *
 * `blockers` is a list and not a single error because the panel shows all the reasons
 * at once: a worker who is busy and a machine below the minimum condition are two
 * independent problems, and reporting them one at a time turns the panel into a
 * guessing game. Each blocker is a full error body, with the same codes the mutating
 * route would return.
 */
export const taskEstimateReplySchema = z.strictObject({
  feasible: z.boolean(),
  blockers: z.array(apiErrorSchema),
  operation: z.enum(TaskOperation),
  /** Cells or trees the task would work on. */
  units: countSchema,
  effectiveWorkSpeedMilli: z.number().int().nonnegative(),
  durationGameHours: gameHoursSchema,
  durationGameMs: gameMsSchema,
  scheduledEndGameMs: gameMsSchema,
  /** Operating cost of the machines over the whole task (GDD sections 94 and 114). */
  operatingCost: moneySchema,
  /** Wages of the assigned worker over the same interval. Accrued anyway (GDD 107). */
  workerWages: moneySchema,
  /** Condition each machine would lose, in basis points (GDD section 93). */
  conditionLossBp: z.number().int().nonnegative(),
  /** What the task would produce, in the stored unit of its resource, or null. */
  expectedProductionUnits: storageUnitsSchema.nullable(),
  /** Storage the task would reserve, or null when it produces nothing. */
  reservedStorageUnits: storageUnitsSchema.nullable(),
  /** Production that would not fit in the destination storage (GDD sections 83 and 97). */
  overflowUnits: storageUnitsSchema,
  atGameMs: gameMsSchema,
});
export type TaskEstimateReply = z.infer<typeof taskEstimateReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/tasks and POST /api/tasks/:taskId/cancel
// ---------------------------------------------------------------------------

/**
 * Creating a task moves no money at the moment of creation: the operating cost is a
 * continuous accrual over the interval the task runs (plan section 6.2). It therefore
 * carries no idempotency key; what protects it from a double submission is the
 * conditional reservation of the worker and the machines, which reports
 * `WORKER_NOT_IDLE` or `MACHINE_NOT_IDLE`.
 */
export const createTaskResultSchema = z.strictObject({
  task: taskDtoSchema,
  /** State of the target after the assignment, so the panel needs no second request. */
  targetFieldId: fieldIdSchema.nullable(),
  targetForestPlotId: forestPlotIdSchema.nullable(),
});
export type CreateTaskResult = z.infer<typeof createTaskResultSchema>;

/**
 * Cancellation is all or nothing for the target (GDD section 106): the field stays in
 * its previous state and the partial progress is lost. Nothing is refunded, and the
 * wear is applied prorated over the hours actually worked (plan section 2.2).
 */
export const cancelTaskResultSchema = z.strictObject({
  task: taskDtoSchema,
  /** Condition each machine ended with, keyed by machine. */
  machineConditionBp: z.array(
    z.strictObject({
      machineId: machineIdSchema,
      conditionBp: z.number().int().min(0).max(10_000),
    }),
  ),
  /** Storage the cancellation released, in the stored unit of the resource. */
  releasedStorageUnits: storageUnitsSchema.nullable(),
});
export type CancelTaskResult = z.infer<typeof cancelTaskResultSchema>;
