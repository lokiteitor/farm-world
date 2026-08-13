// Module `forestry`: the plot, the tree, the batch felling, the replanting and the clearing
// (GDD sections 10 and 128 to 141).
//
// Owner: workflow W6-C. Replaces the scaffolding workflow W3-A left with the definitive path and
// signature (plan section 11, rule 3): `src/app.ts`, `src/handlers.ts` and the route registry
// were not touched, only the body of this module. `defineStubRoute` became `defineRoute`, in
// place.
//
// The shape of the module, which is a chain and never a loop:
//
//   `generator.ts` the deterministic draw of a wild forest (GDD section 130). Pure.
//   `record.ts`    the rows of the area and their loaders. No writes, no derived arithmetic.
//   `readModel.ts` the entities of the contract and the frames.
//   `service.ts`   the plot: creation, the one shot generation mark, the milestone schedule and
//                  the clearing of felled ground.
//   `tasks.ts`     the three operations: assignment, completion and the release of a
//                  cancellation.
//   `jobs.ts`      the handler of `FOREST_NOTIFY_MILESTONE` and the forestry contribution to
//                  `TASK_COMPLETE`.
//   `routes.ts`    the HTTP surface, deliberately thin.
//
// WHAT ENTERS THE MVP OF THIS SYSTEM (GDD section 141), and where each item is:
//
//   ForestPlot separate from Field, multi chunk        `service.ts`, `createForestPlot`
//   Individual Tree with four growth stages            `shared/rules/forestry.ts`, derived
//   Procedural generation of a populated forest        `generator.ts`
//   Batch felling, never tree by tree from the UI      `tasks.ts`, `assignFellTask`
//   One species                                        `shared/config/forestry.ts`, `PINE`
//   Separate forestry machinery                        `shared/config/machines.ts`
//   Wood store as a building of its own                `shared/config/buildings.ts`
//   Manual replanting, never automatic                 `tasks.ts`, `assignReplantTask`
//   Worker and skillFactor reused with no forestry skill `modules/workers`, unchanged
//
// And what does not: felling one tree at a time from the interface, several species, converting
// a field back to forest, and a forestry skill distinct from the agricultural one.
//
// WHAT THIS MODULE DOES NOT DO. It never stores the stage, the age or the volume of a tree: all
// three are derived from `plantedAtGameMs`, the species and the clock, which is the resolution of
// GDD section 130 against GDD section 140 (ADR-0030). It never counts storage capacity: the store
// belongs to the farm and `modules/farms/service.ts` is the one place that writes it. It never
// turns wood into money: that is `modules/economy`, through `POST /api/market/sell`. And it never
// writes a cell directly except for the two columns `modules/world` does not expose, the terrain
// override of a clearing and the consumption mark of the generator, both with the same discipline
// that module uses.

import { type FastifyInstance } from 'fastify';
import { registerForestryScheduledHandlers } from './jobs.js';
import { registerForestryRoutes as registerRoutes } from './routes.js';

/**
 * Registers the routes of the area and the forestry contribution to `TASK_COMPLETE`.
 *
 * The two are registered together because they are the two halves of one lifecycle: the routes
 * assign the three operations and the handler completes them. It is the same pattern
 * `registerEconomyRoutes` uses for the forced liquidation of ADR-0039, and it is idempotent.
 * Invoked once by `src/app.ts`.
 */
export function registerForestryRoutes(app: FastifyInstance): void {
  registerRoutes(app);
  registerForestryScheduledHandlers();
}

export {
  FOREST_SALT,
  forestUnitHash,
  generateNaturalForest,
  generatedFellableVolumeDm3,
  generatedFellableVolumeM3,
  naturalTreeAt,
  stageAgeWindow,
  stageForDraw,
  type GeneratedTree,
} from './generator.js';

export {
  FOREST_PLOT_REF_TYPE,
  TASK_REF_TYPE,
  findLivePlot,
  findTask,
  loadPlayerPlots,
  pageTrees,
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

export {
  buildForestPlotDto,
  emptyStageHistogram,
  forestPlotUpsertedFrame,
  stageHistogramOf,
  standingWoodDm3,
  taskUpsertedFrame,
  toTaskDto,
  toTreeDto,
  treesUpsertedFrame,
  woodValue,
} from './readModel.js';

export {
  MILESTONE_WINDOW_GAME_HOURS,
  MILESTONE_WINDOW_GAME_MS,
  applyClearing,
  createForestPlot,
  insertTrees,
  isAtMilestone,
  markNaturalTreesConsumed,
  milestoneWindowEnd,
  nextMilestoneGameMs,
  refreshPlotCellCount,
  requireValidForestSelection,
  syncMilestoneSchedule,
  treesCrossingMilestone,
  unconsumedCells,
  type CreateForestPlotInput,
  type CreateForestPlotOutcome,
} from './service.js';

export {
  FORESTRY_OPERATIONS,
  assignClearLandTask,
  assignFellTask,
  assignReplantTask,
  completeForestryTask,
  emptyCellsOfPlot,
  freeWoodCapacity,
  isForestryOperation,
  liveTreesOfArea,
  releaseForestryTask,
  type ClearLandInput,
  type FellInput,
  type ForestryAssignment,
  type ReplantInput,
} from './tasks.js';

export {
  OWNED_EVENT_KIND,
  composeTaskCompleteHandler,
  forestNotifyMilestoneHandler,
  registerForestryScheduledHandlers,
  resetForestryScheduledHandlerRegistration,
} from './jobs.js';
