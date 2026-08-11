// Forestry area: forest plots, trees, felling, replanting and clearing.
//
// Owner: workflow W2 (API contract).
//
// A tree stores only when it was planted. Its age, its growth stage and its wood
// volume are derived from that instant, the species and the clock, and never stored
// (plan section 2.2, resolution of GDD sections 130 and 140): tens of thousands of
// trees make a scheduled job per tree unviable, and GDD section 131 confirms that
// nothing is triggered when a tree matures. The reply carries the derived values
// because they are what the panel shows, together with the planting instant, so the
// client keeps deriving them on its own between replies with the same pure rules.
//
// A felled tree is not deleted. The row stays with `felledAtGameMs` set and status
// `FELLED`, which keeps the ledger pointing at something and reserves the meaning
// "felled and awaiting transport" for when the forwarder of GDD section 134 stops
// being a mere ownership requirement. Queries for standing trees filter by status.

import { z } from 'zod';
import { TreeGrowthStage, TreeSpecies, TreeStatus } from '../../domain/enums.js';
import {
  cellOrdinateSchema,
  cellSelectionSchema,
  countSchema,
  cursorSchema,
  farmIdSchema,
  forestPlotIdSchema,
  gameHoursSchema,
  gameMsSchema,
  limitQuerySchema,
  MAX_TREES_PER_REPLY,
  moneySchema,
  nameSchema,
  storageUnitsSchema,
  taskIdSchema,
  treeIdSchema,
} from './common.js';
import {
  clearLandTaskRequestSchema,
  fellTaskRequestSchema,
  replantTaskRequestSchema,
} from './tasks.js';

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/** Count of trees per growth stage. Every stage is present, with zero where empty. */
export const treeStageHistogramSchema = z.strictObject({
  SAPLING: countSchema,
  YOUNG: countSchema,
  MATURE: countSchema,
  OLD_GROWTH: countSchema,
});
export type TreeStageHistogram = z.infer<typeof treeStageHistogramSchema>;

export const forestPlotDtoSchema = z.strictObject({
  id: forestPlotIdSchema,
  /** Farm that serves the plot, and destination of the felled wood (plan section 2.2). */
  farmId: farmIdSchema.nullable(),
  name: nameSchema,
  cellCount: countSchema,
  /** Cells of the plot that carry no tree, which are the ones replanting can fill. */
  emptyCellCount: countSchema,
  standingTreeCount: countSchema,
  /** Standing trees whose stage admits felling (GDD section 131). */
  fellableTreeCount: countSchema,
  /** Wood the standing trees hold, in cubic decimetres. */
  standingWoodDm3: storageUnitsSchema,
  /** Wood the fellable trees hold, which is what a clear cut would produce now. */
  fellableWoodDm3: storageUnitsSchema,
  /** Value of the fellable wood at the fixed price of GDD section 133. */
  fellableWoodValue: moneySchema,
  stageHistogram: treeStageHistogramSchema,
  currentTaskId: taskIdSchema.nullable(),
  createdAtGameMs: gameMsSchema,
  atGameMs: gameMsSchema,
});
export type ForestPlotDto = z.infer<typeof forestPlotDtoSchema>;

export const forestPlotsReplySchema = z.strictObject({
  plots: z.array(forestPlotDtoSchema),
});
export type ForestPlotsReply = z.infer<typeof forestPlotsReplySchema>;

export const forestPlotParamsSchema = z.strictObject({ forestPlotId: forestPlotIdSchema });
export type ForestPlotParams = z.infer<typeof forestPlotParamsSchema>;

export const treeDtoSchema = z.strictObject({
  id: treeIdSchema,
  forestPlotId: forestPlotIdSchema,
  cellX: cellOrdinateSchema,
  cellY: cellOrdinateSchema,
  species: z.enum(TreeSpecies),
  /** The only stored temporal datum. May be in the past for a generated tree. */
  plantedAtGameMs: gameMsSchema,
  status: z.enum(TreeStatus),
  felledAtGameMs: gameMsSchema.nullable(),
  /** True for the trees the world generated, false for replanted ones (GDD section 130). */
  naturallyGenerated: z.boolean(),
  /** Derived at `atGameMs` of the reply, never stored. */
  ageGameHours: gameHoursSchema,
  growthStage: z.enum(TreeGrowthStage),
  woodVolumeDm3: storageUnitsSchema,
  fellable: z.boolean(),
  /** Instant the tree reaches the next stage, or null at `OLD_GROWTH`. */
  nextStageAtGameMs: gameMsSchema.nullable(),
});
export type TreeDto = z.infer<typeof treeDtoSchema>;

export const forestPlotTreesQuerySchema = z.strictObject({
  status: z.enum(TreeStatus).optional(),
  limit: limitQuerySchema(MAX_TREES_PER_REPLY, MAX_TREES_PER_REPLY),
  cursor: cursorSchema.optional(),
});
export type ForestPlotTreesQuery = z.infer<typeof forestPlotTreesQuerySchema>;

/**
 * Detail of one plot. The trees are paginated: a plot may hold as many trees as it has
 * cells, and the ceiling of a page is the same ceiling a selection has, so no reply is
 * ever larger than the request that could produce it.
 */
export const forestPlotDetailReplySchema = z.strictObject({
  plot: forestPlotDtoSchema,
  trees: z.array(treeDtoSchema),
  nextCursor: cursorSchema.nullable(),
  atGameMs: gameMsSchema,
});
export type ForestPlotDetailReply = z.infer<typeof forestPlotDetailReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/forest-plots
// ---------------------------------------------------------------------------

/**
 * Creating a plot over forest cells the player owns generates the natural forest,
 * already populated with trees at different stages (GDD sections 130 and 141). It moves
 * no money: the land was paid for when it was bought.
 *
 * The generation happens once per cell. `naturalTreeConsumed` on the cell is what stops
 * deleting and recreating a plot from farming free trees (plan section 5.1), and that is
 * what `NATURAL_TREES_ALREADY_CONSUMED` reports.
 */
export const createForestPlotBodySchema = z.strictObject({
  name: nameSchema,
  farmId: farmIdSchema.nullable(),
  cells: cellSelectionSchema.shape.cells,
});
export type CreateForestPlotBody = z.infer<typeof createForestPlotBodySchema>;

export const createForestPlotResultSchema = z.strictObject({
  plot: forestPlotDtoSchema,
  /** Trees the generation produced. Capped like any other tree page. */
  trees: z.array(treeDtoSchema),
  generatedTreeCount: countSchema,
});
export type CreateForestPlotResult = z.infer<typeof createForestPlotResultSchema>;

// ---------------------------------------------------------------------------
// POST /api/forest-plots/:forestPlotId/fell
// ---------------------------------------------------------------------------

/**
 * Batch felling (GDD section 132, option B: the interface selects a plot or a sub area,
 * never one tree). `cells` restricts the batch; omitted means every fellable tree of
 * the plot.
 *
 * The route creates a task and returns it. It moves no money at the moment of
 * creation, so it carries no idempotency key; the reservation of the worker and the
 * machine is what makes a double submission fail.
 */
export const fellBodySchema = fellTaskRequestSchema.omit({
  operation: true,
  targetForestPlotId: true,
});
export type FellBody = z.infer<typeof fellBodySchema>;

// ---------------------------------------------------------------------------
// POST /api/forest-plots/:forestPlotId/replant
// ---------------------------------------------------------------------------

/**
 * Replanting is manual and never automatic (GDD section 137): a cell left empty stays
 * empty, exactly like a field left `VIRGIN`, and converting it to arable land instead is
 * the other half of the decision GDD section 10 poses.
 */
export const replantBodySchema = replantTaskRequestSchema.omit({
  operation: true,
  targetForestPlotId: true,
});
export type ReplantBody = z.infer<typeof replantBodySchema>;

// ---------------------------------------------------------------------------
// POST /api/land/clear
// ---------------------------------------------------------------------------

/**
 * Clearing turns felled forest into arable land (GDD section 10), which is the one
 * direction the MVP supports: reforesting a field is outside it (GDD section 137). The
 * route lives in the forestry area because plan section 7 lists it there, although its
 * path belongs to the land namespace.
 */
export const clearLandBodySchema = clearLandTaskRequestSchema.omit({ operation: true });
export type ClearLandBody = z.infer<typeof clearLandBodySchema>;
