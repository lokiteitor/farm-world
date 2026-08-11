// Fields area: geometry, the crop cycle state machine and the projected attributes.
//
// Owner: workflow W2 (API contract).
//
// Stored against projected. A field carries two readings of the same attributes: the
// value that is stored, with the instant it was settled at, and the value projected
// to the clock reading of the reply. Both travel, and neither is redundant: the
// stored pair is what makes the client able to keep projecting on its own between
// replies, using the same pure rules as the server, and the projection is what the
// panel shows. Weed level, fertility and the crop phase are all lazily accrued
// (plan section 6.5), so without the pair the client would have to wait for a
// scheduled job to see a number move.

import { z } from 'zod';
import { CropCycleState, CropId, SoilCondition, TaskOperation } from '../../domain/enums.js';
import {
  bpSchema,
  cellCoordSchema,
  cellSelectionSchema,
  countSchema,
  farmIdSchema,
  fieldIdSchema,
  gameMsSchema,
  nameSchema,
  storageUnitsSchema,
  taskIdSchema,
} from './common.js';

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/**
 * The attributes of the field as they stand at `atGameMs`, computed with the same
 * pure rules the server validates with (plan section 8).
 *
 * `readyAtGameMs` is the instant the field reaches `READY_TO_HARVEST`, projected from
 * the sowing instant and the phase durations of the crop; it is null outside the
 * timed part of the cycle. `expectedYieldLiters` applies the yield formula of GDD
 * section 83 with the projected fertility, weed level and fertilisation.
 */
export const fieldProjectionSchema = z.strictObject({
  atGameMs: gameMsSchema,
  cropCycleState: z.enum(CropCycleState),
  growthProgressBp: bpSchema,
  weedLevelBp: bpSchema,
  fertilityBp: bpSchema,
  fertilizationBp: bpSchema,
  readyAtGameMs: gameMsSchema.nullable(),
  expectedYieldLiters: storageUnitsSchema,
  /** Operations the state of the field admits right now (GDD sections 76 and 90). */
  availableOperations: z.array(z.enum(TaskOperation)),
});
export type FieldProjection = z.infer<typeof fieldProjectionSchema>;

export const fieldDtoSchema = z.strictObject({
  id: fieldIdSchema,
  /** Farm that serves the field, and destination of its harvest (plan section 2.2). */
  farmId: farmIdSchema.nullable(),
  name: nameSchema,
  cellCount: countSchema,
  cropId: z.enum(CropId).nullable(),
  /** Stored state of the machine, which a materialising job may not have advanced yet. */
  cropCycleState: z.enum(CropCycleState),
  soilCondition: z.enum(SoilCondition),
  /** Stored attributes, each with the instant it was last settled at. */
  fertilityBp: bpSchema,
  fertilityUpdatedAtGameMs: gameMsSchema,
  weedLevelBp: bpSchema,
  weedLevelUpdatedAtGameMs: gameMsSchema,
  fertilizationBp: bpSchema,
  fertilizationUpdatedAtGameMs: gameMsSchema,
  stateEnteredAtGameMs: gameMsSchema,
  seededAtGameMs: gameMsSchema.nullable(),
  currentTaskId: taskIdSchema.nullable(),
  createdAtGameMs: gameMsSchema,
  projection: fieldProjectionSchema,
});
export type FieldDto = z.infer<typeof fieldDtoSchema>;

export const fieldsReplySchema = z.strictObject({
  fields: z.array(fieldDtoSchema),
});
export type FieldsReply = z.infer<typeof fieldsReplySchema>;

export const fieldParamsSchema = z.strictObject({ fieldId: fieldIdSchema });
export type FieldParams = z.infer<typeof fieldParamsSchema>;

/**
 * Detail of one field. The cells travel here and not in the listing: a player with
 * many fields would otherwise download the whole geometry of the holding on every
 * refresh, while the renderer already gets the geometry from the chunk layer.
 */
export const fieldDetailReplySchema = z.strictObject({
  field: fieldDtoSchema,
  cells: z.array(cellCoordSchema),
});
export type FieldDetailReply = z.infer<typeof fieldDetailReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/fields
// ---------------------------------------------------------------------------
//
// None of the four geometry operations moves money: the land is already owned and a
// field is a logical entity over it (GDD sections 13 and 19). They therefore carry no
// idempotency key; what protects them from a double submission is the exclusivity of
// use of the cell, which is a conditional update with a row count check (plan
// section 5.4).

export const createFieldBodySchema = z.strictObject({
  name: nameSchema,
  /** Farm that will serve the field. Null while the player has no farm yet. */
  farmId: farmIdSchema.nullable(),
  cells: cellSelectionSchema.shape.cells,
});
export type CreateFieldBody = z.infer<typeof createFieldBodySchema>;

export const fieldMutationResultSchema = z.strictObject({
  field: fieldDtoSchema,
  cells: z.array(cellCoordSchema),
});
export type FieldMutationResult = z.infer<typeof fieldMutationResultSchema>;

// ---------------------------------------------------------------------------
// POST /api/fields/:fieldId/extend
// ---------------------------------------------------------------------------

/**
 * Extension requires the new cells to be owned, arable, free of infrastructure and
 * adjacent to the field, and the union to stay contiguous (GDD sections 17 and 20).
 */
export const extendFieldBodySchema = z.strictObject({
  cells: cellSelectionSchema.shape.cells,
});
export type ExtendFieldBody = z.infer<typeof extendFieldBodySchema>;

// ---------------------------------------------------------------------------
// POST /api/fields/:fieldId/split
// ---------------------------------------------------------------------------

/**
 * The cells listed leave the field and become a new one; the remainder stays. Both
 * halves must be contiguous and non empty, which is what `FIELD_SPLIT_INCOMPLETE`
 * reports. The parallel attributes travel with each half unchanged: GDD section 22
 * asks that a geometry operation not destroy agricultural progress without an
 * explicit reason, and a split has none.
 */
export const splitFieldBodySchema = z.strictObject({
  name: nameSchema,
  cells: cellSelectionSchema.shape.cells,
});
export type SplitFieldBody = z.infer<typeof splitFieldBodySchema>;

export const splitFieldResultSchema = z.strictObject({
  original: fieldDtoSchema,
  created: fieldDtoSchema,
  movedCells: z.array(cellCoordSchema),
});
export type SplitFieldResult = z.infer<typeof splitFieldResultSchema>;

// ---------------------------------------------------------------------------
// POST /api/fields/merge
// ---------------------------------------------------------------------------

/**
 * Merging validates contiguity of the union, ownership, and compatibility of the
 * agricultural state (GDD section 22): two fields at different points of the cycle
 * cannot become one, because the result would have to discard one of the two
 * histories. `FIELD_MERGE_INCOMPATIBLE` reports it.
 */
export const mergeFieldsBodySchema = z.strictObject({
  name: nameSchema,
  fieldIds: z.array(fieldIdSchema).min(2).max(32),
});
export type MergeFieldsBody = z.infer<typeof mergeFieldsBodySchema>;

export const mergeFieldsResultSchema = z.strictObject({
  field: fieldDtoSchema,
  removedFieldIds: z.array(fieldIdSchema),
});
export type MergeFieldsResult = z.infer<typeof mergeFieldsResultSchema>;
