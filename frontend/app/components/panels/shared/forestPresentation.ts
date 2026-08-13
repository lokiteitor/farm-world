// How a forest plot and its trees are counted, valued and named in the interface.
//
// Owner: W6-D. Read by the forestry listing and by the plot inspector.
//
// It is in `components/panels/shared/` because the two panels of the subject need the same
// arithmetic and neither of them owns the other (ADR-0037, and the closing note of W5).
//
// Everything a tree is, except when it was planted, is derived (ADR-0030 of the plan,
// implemented in `shared/rules/forestry.ts`): the stage from the age, the volume from the
// stage, the value from the volume. So this module derives nothing of its own. What it does
// is three conversions the interface needs and the domain deliberately does not do:
//
//   - Cubic decimetres to cubic metres. Stock is an integer in the stored unit because the
//     volumes of GDD section 131 are multiples of 0.05 m³ and adding thousands of them as
//     floating point numbers would make a batch depend on the order of the sum
//     (`shared/config/buildings.ts`). The player reads m³, which is the unit of GDD sections
//     131, 133 and 136, and the divisor is the one of `STORAGE_RESOURCE_UNITS`.
//   - The stage histogram as an ordered list, because a record has no order and the four
//     stages of GDD section 131 have one: the reading only makes sense as a life cycle.
//   - The value of a batch, which is `woodSaleRevenue` of `shared/rules/pricing.ts`, the same
//     function the server writes the ledger entry with (ADR-0048, last paragraph). The price
//     of GDD section 133 is never multiplied in a panel.

import { TREE_STAGE_LABELS, treeStageColour } from '~/components/panels/legend/vocabulary';
import {
  DM3_PER_M3,
  STORAGE_RESOURCE_UNITS,
  StorageResource,
  TREE_GROWTH_STAGES,
  TREE_SPECIES_CATALOGUE,
  TreeStatus,
  ValidationCode,
  cellKey,
  fromWireGameMs,
  isFellable,
  treeStageAt,
  woodSaleRevenue,
  type CellCoordWire,
  type ForestPlotDto,
  type GameMs,
  type Money,
  type TreeDto,
  type TreeGrowthStage,
  type TreeView,
} from '~/shared/index';

/** Cubic metres from the stored cubic decimetres, for display only. */
export function woodM3(volumeDm3: number): number {
  return volumeDm3 / STORAGE_RESOURCE_UNITS[StorageResource.WOOD_M3].displayDivisor;
}

/** Value of a volume of wood at the fixed price of GDD section 133. */
export function woodValue(volumeDm3: number): Money {
  return woodSaleRevenue(TREE_SPECIES_CATALOGUE.PINE, Math.round(volumeDm3));
}

export interface StageRow {
  readonly stage: TreeGrowthStage;
  readonly label: string;
  /** The colour of the canopy of that stage on the canvas, so panel and lienzo agree. */
  readonly colour: string;
  readonly count: number;
  /** Share of the standing trees, in basis points, for the bar of the histogram. */
  readonly shareBp: number;
  /** Whether the species admits felling a tree of this stage (GDD section 131). */
  readonly fellable: boolean;
  /** Volume one tree of this stage holds, in cubic metres. */
  readonly volumeM3: number;
}

/**
 * The histogram of a plot as an ordered list, one row per stage and zero where empty.
 *
 * Every stage is present even at zero: a forest with no mature trees is a fact worth reading,
 * and a list that dropped the empty rows would make the four stages of the life cycle look
 * like whatever the plot happens to hold today.
 */
export function stageRows(
  histogram: Readonly<Record<TreeGrowthStage, number>>,
): readonly StageRow[] {
  const total = TREE_GROWTH_STAGES.reduce((sum, stage) => sum + histogram[stage], 0);
  const pine = TREE_SPECIES_CATALOGUE.PINE;
  return TREE_GROWTH_STAGES.map((stage) => ({
    stage,
    label: TREE_STAGE_LABELS[stage],
    colour: treeStageColour(stage),
    count: histogram[stage],
    shareBp: total > 0 ? Math.round((histogram[stage] * 10_000) / total) : 0,
    fellable: pine.fellableStages.includes(stage),
    volumeM3: pine.woodVolumeDm3ByStage[stage] / DM3_PER_M3,
  }));
}

/** The row as the shared forestry rules want it, so nothing derives a stage twice. */
export function asTreeView(tree: TreeDto): TreeView {
  return {
    species: tree.species,
    plantedAtGameMs: fromWireGameMs(tree.plantedAtGameMs),
    status: tree.status,
  };
}

export interface AreaComposition {
  readonly standingCount: number;
  readonly fellableCount: number;
  readonly volumeDm3: number;
  readonly volumeM3: number;
  readonly value: Money;
  readonly histogram: Readonly<Record<TreeGrowthStage, number>>;
}

/**
 * Composition of a set of trees at an instant, derived locally with the shared rules.
 *
 * The reply of the server already carries the same figures for the whole plot, and this is
 * not a second opinion about them: it is what answers the same question about a *sub area*,
 * which is what GDD section 132 option B selects and what no route reports. The two agree
 * over the whole plot by construction, because both call `treeStageAt` and `isFellable`.
 */
export function composeArea(trees: readonly TreeDto[], atGameMs: GameMs): AreaComposition {
  const histogram: Record<TreeGrowthStage, number> = {
    SAPLING: 0,
    YOUNG: 0,
    MATURE: 0,
    OLD_GROWTH: 0,
  };
  let standingCount = 0;
  let fellableCount = 0;
  let volumeDm3 = 0;
  const pine = TREE_SPECIES_CATALOGUE.PINE;
  for (const tree of trees) {
    if (tree.status === TreeStatus.FELLED) {
      continue;
    }
    const view = asTreeView(tree);
    const stage = treeStageAt(view, atGameMs);
    histogram[stage] += 1;
    standingCount += 1;
    if (isFellable(view, atGameMs)) {
      fellableCount += 1;
      volumeDm3 += pine.woodVolumeDm3ByStage[stage];
    }
  }
  return {
    standingCount,
    fellableCount,
    volumeDm3,
    volumeM3: woodM3(volumeDm3),
    value: woodValue(volumeDm3),
    histogram,
  };
}

/**
 * Cells of a plot with no standing tree, which are the ones replanting fills.
 *
 * Derived from the geometry and the trees rather than reported: `ForestPlotDto` carries
 * `emptyCellCount` and never the coordinates, and `POST .../replant` names its cells one by
 * one (GDD section 137). An empty result while the plot reports empty cells means the
 * geometry has not arrived yet, which the panel says instead of sending an empty request.
 */
export function emptyCells(
  cells: readonly CellCoordWire[],
  trees: readonly TreeDto[],
): readonly CellCoordWire[] {
  const taken = new Set<number>();
  for (const tree of trees) {
    if (tree.status !== TreeStatus.FELLED) {
      taken.add(cellKey(tree.cellX, tree.cellY));
    }
  }
  return cells.filter((cell) => !taken.has(cellKey(cell.cellX, cell.cellY)));
}

/**
 * Why a plot cannot be felled right now, or null.
 *
 * Only the reasons that belong to the plot itself: a task already running on it and an area
 * with nothing fellable in it. The machinery and the worker are the assignment panel's
 * question, and answering it here as well would be the duplication ADR-0032 forbids.
 */
export function fellBlockingCode(plot: ForestPlotDto): ValidationCode | null {
  if (plot.currentTaskId !== null) {
    return ValidationCode.FIELD_HAS_ACTIVE_TASK;
  }
  return plot.fellableTreeCount > 0 ? null : ValidationCode.NO_FELLABLE_TREES;
}

/** Why a plot cannot be replanted right now, or null (GDD section 137). */
export function replantBlockingCode(plot: ForestPlotDto): ValidationCode | null {
  if (plot.currentTaskId !== null) {
    return ValidationCode.FIELD_HAS_ACTIVE_TASK;
  }
  return plot.emptyCellCount > 0 ? null : ValidationCode.CELL_ALREADY_HAS_TREE;
}

/**
 * Occupancy of a plot in basis points: cells that carry a standing tree.
 *
 * It is the figure that says whether replanting is worth doing, and it is derived from the
 * two counts the plot already reports rather than from the tree page, which is paginated and
 * may not be loaded.
 */
export function occupancyBp(plot: ForestPlotDto): number {
  if (plot.cellCount <= 0) {
    return 0;
  }
  return Math.round((plot.standingTreeCount * 10_000) / plot.cellCount);
}
