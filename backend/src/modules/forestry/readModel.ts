// The entities of the forestry area as the contract carries them, and the frames.
//
// Owner: workflow W6-C. Module `forestry`.
//
// Every derived figure of a tree is an evaluation of `shared/rules/forestry.ts` and never
// arithmetic written here. That is not tidiness: the panel of workflow W6-D derives the stage
// of a tree between two replies with the very same functions, so a tree that grows while the
// player watches does so with no traffic at all (`shared/ws/events.ts`), and the moment this
// file computed a stage of its own the two would drift apart at the first boundary.
//
// The aggregate of a plot is computed over its standing trees and not stored. There is no
// counter to keep in step, which matters because the number that would have to be maintained
// changes without anybody writing anything: a tree crossing 480 game hours moves one unit from
// `YOUNG` to `MATURE` in the histogram and adds 1 400 dm3 to the fellable volume, and no
// transaction happened.

import { type DomainEventDraft } from '../../lib/events.js';
import {
  DM3_PER_M3,
  GameEventType,
  type Money,
  PINE,
  TREE_GROWTH_STAGES,
  TreeStatus,
  batchWoodVolume,
  isFellable,
  nextStageBoundaryGameMs,
  toWireGameMs,
  toWireMoney,
  treeAgeGameHours,
  treeStageAt,
  treeWoodVolumeDm3,
  woodSaleRevenue,
  type CellCoord,
  type ForestPlotDto,
  type GameMs,
  type TaskDto,
  type TreeDto,
  type TreeGrowthStage,
  type TreeStageHistogram,
} from '../../shared/index.js';
import { treeView, type ForestPlotRecord, type TaskRecord, type TreeRecord } from './record.js';

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

/** A tree as the contract carries it, with the derived readings taken at `atGameMs`. */
export function toTreeDto(tree: TreeRecord, atGameMs: GameMs): TreeDto {
  const view = treeView(tree);
  const nextBoundary = nextStageBoundaryGameMs(view, atGameMs);
  return {
    id: tree.id,
    forestPlotId: tree.forestPlotId,
    cellX: tree.cellX,
    cellY: tree.cellY,
    species: tree.species,
    plantedAtGameMs: toWireGameMs(tree.plantedAtGameMs),
    status: tree.status,
    felledAtGameMs: tree.felledAtGameMs === null ? null : toWireGameMs(tree.felledAtGameMs),
    naturallyGenerated: tree.naturallyGenerated,
    ageGameHours: treeAgeGameHours(tree.plantedAtGameMs, atGameMs),
    growthStage: treeStageAt(view, atGameMs),
    woodVolumeDm3: treeWoodVolumeDm3(view, atGameMs),
    fellable: isFellable(view, atGameMs),
    nextStageAtGameMs: nextBoundary === null ? null : toWireGameMs(nextBoundary),
  };
}

/** An empty histogram, so every stage is present with zero where it is empty. */
export function emptyStageHistogram(): TreeStageHistogram {
  return { SAPLING: 0, YOUNG: 0, MATURE: 0, OLD_GROWTH: 0 };
}

/** Counts of standing trees by derived stage (GDD section 131). */
export function stageHistogramOf(
  trees: readonly TreeRecord[],
  atGameMs: GameMs,
): TreeStageHistogram {
  const histogram: Record<TreeGrowthStage, number> = emptyStageHistogram();
  for (const tree of trees) {
    if (tree.status === TreeStatus.FELLED) {
      continue;
    }
    histogram[treeStageAt(treeView(tree), atGameMs)] += 1;
  }
  return histogram;
}

/** Wood the standing trees of a set hold, in cubic decimetres, saplings included. */
export function standingWoodDm3(trees: readonly TreeRecord[], atGameMs: GameMs): number {
  let volume = 0;
  for (const tree of trees) {
    if (tree.status === TreeStatus.FELLED) {
      continue;
    }
    volume += treeWoodVolumeDm3(treeView(tree), atGameMs);
  }
  return volume;
}

// ---------------------------------------------------------------------------
// Forest plot
// ---------------------------------------------------------------------------

/**
 * A plot as the contract carries it, with its counters recomputed over its standing trees.
 *
 * `fellableWoodDm3` is what a clear cut would produce right now, which is
 * `batchWoodVolume` of the shared rule: saplings count towards the tree count, because GDD
 * section 135 makes the duration depend on the trees in the area, and contribute no volume,
 * because GDD section 131 gives them no commercial value.
 */
export function buildForestPlotDto(
  plot: ForestPlotRecord,
  trees: readonly TreeRecord[],
  atGameMs: GameMs,
): ForestPlotDto {
  const batch = batchWoodVolume(trees.map(treeView), atGameMs);
  const standing = standingWoodDm3(trees, atGameMs);
  const empty = plot.cellCount - batch.treeCount;
  return {
    id: plot.id,
    farmId: plot.farmId,
    name: plot.name,
    cellCount: plot.cellCount,
    emptyCellCount: empty > 0 ? empty : 0,
    standingTreeCount: batch.treeCount,
    fellableTreeCount: batch.fellableCount,
    standingWoodDm3: standing,
    fellableWoodDm3: batch.volumeDm3,
    fellableWoodValue: toWireMoney(woodSaleRevenue(PINE, batch.volumeDm3)),
    stageHistogram: stageHistogramOf(trees, atGameMs),
    currentTaskId: plot.currentTaskId,
    createdAtGameMs: toWireGameMs(plot.createdAtGameMs),
    atGameMs: toWireGameMs(atGameMs),
  };
}

/**
 * The frame every write of this module emits for the plot it touched.
 *
 * `cells` carries the geometry when it changed and null when it did not, which is the same
 * rule `FIELD_UPSERTED` follows. The contract admits the geometry in the frame and not in
 * `ForestPlotDto`, so this is the one channel through which a client learns which cells a plot
 * covers without downloading every tree (ADR-0051).
 */
export function forestPlotUpsertedFrame(
  plot: ForestPlotRecord,
  trees: readonly TreeRecord[],
  atGameMs: GameMs,
  cells: readonly CellCoord[] | null,
): DomainEventDraft {
  return {
    type: GameEventType.FOREST_PLOT_UPSERTED,
    payload: {
      plot: buildForestPlotDto(plot, trees, atGameMs),
      cells:
        cells === null ? null : cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
    },
  };
}

/**
 * The frame a plot that no longer exists produces (`shared/ws/events.ts`).
 *
 * The only path that reaches it is a clearing that converted every cell of the plot: the plot
 * is closed with `disposedGameMs` and the client drops it, which is what keeps the two sides
 * agreeing without the client having to infer a deletion from a plot of no cells.
 */
export function forestPlotRemovedFrame(forestPlotId: string): DomainEventDraft {
  return { type: GameEventType.FOREST_PLOT_REMOVED, payload: { forestPlotId } };
}

/** The frame a felling, a replanting and a milestone produce (`shared/ws/events.ts`). */
export function treesUpsertedFrame(
  plot: ForestPlotRecord,
  standing: readonly TreeRecord[],
  changed: readonly TreeRecord[],
  atGameMs: GameMs,
  removedTreeIds: readonly string[] = [],
): DomainEventDraft {
  return {
    type: GameEventType.TREES_UPSERTED,
    payload: {
      forestPlotId: plot.id,
      trees: changed.map((tree) => toTreeDto(tree, atGameMs)),
      removedTreeIds: [...removedTreeIds],
      plot: buildForestPlotDto(plot, standing, atGameMs),
    },
  };
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

/**
 * A task as the contract carries it.
 *
 * `progressBp` is derived from the clock and never stored, and a cancelled task is clamped at
 * the fraction it really ran: `endedGameMs` differs from `scheduledEndGameMs` exactly when the
 * task was cancelled, and GDD section 106 refunds nothing, so the bar must stop where the work
 * stopped (ADR-0045).
 */
export function toTaskDto(task: TaskRecord, atGameMs: GameMs): TaskDto {
  const scheduled = task.scheduledEndGameMs - task.startGameMs;
  const reached = (task.endedGameMs ?? atGameMs) - task.startGameMs;
  const progressBp =
    scheduled <= 0n
      ? 10_000
      : Number(
          ((reached < 0n ? 0n : reached > scheduled ? scheduled : reached) * 10_000n) / scheduled,
        );
  return {
    id: task.id,
    workerId: task.workerId,
    machineIds: [...task.machineIds],
    operation: task.operation,
    status: task.status,
    targetFieldId: task.targetFieldId,
    targetForestPlotId: task.targetForestPlotId,
    destinationFarmId: task.destinationFarmId,
    cropId: null,
    unitsAtStart: task.unitsAtStart,
    effectiveWorkSpeedMilli: task.effectiveWorkSpeedMilli,
    reservedStorageUnits: task.reservedStorageUnits,
    startGameMs: toWireGameMs(task.startGameMs),
    scheduledEndGameMs: toWireGameMs(task.scheduledEndGameMs),
    endedGameMs: task.endedGameMs === null ? null : toWireGameMs(task.endedGameMs),
    cancelable: task.cancelable,
    progressBp,
  };
}

export function taskUpsertedFrame(task: TaskRecord, atGameMs: GameMs): DomainEventDraft {
  return { type: GameEventType.TASK_UPSERTED, payload: { task: toTaskDto(task, atGameMs) } };
}

/** Value of a volume of wood at the fixed price of GDD section 133, for a log line. */
export function woodValue(volumeDm3: number): Money {
  return woodSaleRevenue(PINE, volumeDm3);
}

/** Cubic metres of a stored volume, for the figures GDD section 138 publishes. */
export function toCubicMetres(volumeDm3: number): number {
  return volumeDm3 / DM3_PER_M3;
}

/** The stages, in the published order. Re-exported so a caller has one import. */
export const STAGE_ORDER = TREE_GROWTH_STAGES;
