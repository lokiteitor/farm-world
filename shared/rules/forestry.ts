// Trees: age, growth stage and wood volume.
//
// Owner: workflow W2 (pure rules).
//
// Nothing about a tree is stored except when it was planted (plan section 2.2,
// resolution of GDD sections 130 and 140): age, stage and volume are derived here
// from that instant, the species and the clock. Tens of thousands of trees make a
// scheduled job per tree unviable, and GDD section 131 confirms that nothing is
// triggered when a tree matures, so a purely lazy attribute is not a shortcut but the
// correct model.
//
// The stage boundaries are 240, 480 and 720 game hours. GDD section 133 multiplies
// the 240 h of a stage by four and reads 960 h to reach `OLD_GROWTH`, but four stages
// have three boundaries and the fourth stage is the one already reached; the 960 h
// figure is documented as a misreading in the errata.

import {
  TREE_SPECIES_CATALOGUE,
  type NaturalForestParams,
  type TreeSpeciesDefinition,
} from '../config/forestry.js';
import {
  TREE_GROWTH_STAGES,
  TreeStatus,
  type TreeSpecies,
  type TreeGrowthStage,
} from '../domain/enums.js';
import {
  DM3_PER_M3,
  addGameMs,
  gameHours,
  gameHoursToGameMs,
  type GameHours,
  type GameMs,
} from '../domain/units.js';

/** The part of a tree these rules need. */
export interface TreeView {
  readonly species: TreeSpecies;
  readonly plantedAtGameMs: GameMs;
  readonly status: TreeStatus;
}

/**
 * Age of a tree in game hours, never negative: a tree generated with a planting
 * instant in the future, which the natural forest generator never produces, would
 * simply be a sapling of age zero.
 */
export function treeAgeGameHours(plantedAtGameMs: GameMs, atGameMs: GameMs): GameHours {
  const elapsed = atGameMs - plantedAtGameMs;
  if (elapsed <= 0n) {
    return gameHours(0);
  }
  return gameHours(Number(elapsed) / 3_600_000);
}

/**
 * Growth stage for an age (GDD section 131). The last stage whose start the age has
 * reached, so the boundaries are closed on the left and the function is total for any
 * age, including one beyond the last boundary, where growth has stopped.
 */
export function treeStageForAge(
  ageGameHours: number,
  definition: TreeSpeciesDefinition,
  stageOrder: readonly TreeGrowthStage[] = TREE_GROWTH_STAGES,
): TreeGrowthStage {
  const first = stageOrder[0];
  if (first === undefined) {
    throw new RangeError('A species must define at least one growth stage');
  }
  let stage: TreeGrowthStage = first;
  for (const candidate of stageOrder) {
    if (ageGameHours >= definition.stageStartGameHours[candidate]) {
      stage = candidate;
    }
  }
  return stage;
}

/** Growth stage of a tree at an instant. */
export function treeStageAt(
  tree: TreeView,
  atGameMs: GameMs,
  catalogue: Readonly<Record<TreeSpecies, TreeSpeciesDefinition>> = TREE_SPECIES_CATALOGUE,
): TreeGrowthStage {
  const definition = catalogue[tree.species];
  return treeStageForAge(treeAgeGameHours(tree.plantedAtGameMs, atGameMs), definition);
}

/** Instant at which a tree enters a stage, which is what the milestone job is scheduled at. */
export function treeStageBoundaryGameMs(
  plantedAtGameMs: GameMs,
  stage: TreeGrowthStage,
  definition: TreeSpeciesDefinition,
): GameMs {
  return addGameMs(plantedAtGameMs, gameHoursToGameMs(definition.stageStartGameHours[stage]));
}

/**
 * Instant of the next change of stage, or null once the tree has reached the last
 * one, where the volume is stagnant (GDD sections 131 and 133).
 */
export function nextStageBoundaryGameMs(
  tree: TreeView,
  atGameMs: GameMs,
  catalogue: Readonly<Record<TreeSpecies, TreeSpeciesDefinition>> = TREE_SPECIES_CATALOGUE,
  stageOrder: readonly TreeGrowthStage[] = TREE_GROWTH_STAGES,
): GameMs | null {
  const definition = catalogue[tree.species];
  const current = treeStageAt(tree, atGameMs, catalogue);
  const index = stageOrder.indexOf(current);
  const next = index === -1 ? undefined : stageOrder[index + 1];
  if (next === undefined) {
    return null;
  }
  return treeStageBoundaryGameMs(tree.plantedAtGameMs, next, definition);
}

/**
 * Wood volume of a tree in cubic decimetres (GDD section 131), which is the unit the
 * wood store holds: the published volumes are multiples of 0.05 m³ and adding
 * thousands of them as floating point numbers would make a batch depend on the order
 * of the sum.
 */
export function treeWoodVolumeDm3(
  tree: TreeView,
  atGameMs: GameMs,
  catalogue: Readonly<Record<TreeSpecies, TreeSpeciesDefinition>> = TREE_SPECIES_CATALOGUE,
): number {
  const definition = catalogue[tree.species];
  return definition.woodVolumeDm3ByStage[treeStageAt(tree, atGameMs, catalogue)];
}

/** Wood volume of a tree in cubic metres, for display (GDD section 131). */
export function treeWoodVolumeM3(
  tree: TreeView,
  atGameMs: GameMs,
  catalogue: Readonly<Record<TreeSpecies, TreeSpeciesDefinition>> = TREE_SPECIES_CATALOGUE,
): number {
  return treeWoodVolumeDm3(tree, atGameMs, catalogue) / DM3_PER_M3;
}

/** Whether a tree may be felled: a sapling may not (GDD section 131). */
export function isFellable(
  tree: TreeView,
  atGameMs: GameMs,
  catalogue: Readonly<Record<TreeSpecies, TreeSpeciesDefinition>> = TREE_SPECIES_CATALOGUE,
): boolean {
  if (tree.status === TreeStatus.FELLED) {
    return false;
  }
  const definition = catalogue[tree.species];
  return definition.fellableStages.includes(treeStageAt(tree, atGameMs, catalogue));
}

export interface BatchWoodVolume {
  /** Trees counted, that is those not already felled (GDD section 135). */
  readonly treeCount: number;
  /** Of those, the ones the species allows to be felled. */
  readonly fellableCount: number;
  readonly volumeDm3: number;
  readonly volumeM3: number;
}

/**
 * Wood produced by a batch felling (GDD section 135): the sum of the volumes of the
 * trees in the area whose status is not already `FELLED`.
 *
 * Saplings are counted in `treeCount`, because GDD section 135 makes the duration
 * depend on the trees in the area, and excluded from the volume, because GDD section
 * 131 gives them no commercial value and does not allow felling them.
 */
export function batchWoodVolume(
  trees: readonly TreeView[],
  atGameMs: GameMs,
  catalogue: Readonly<Record<TreeSpecies, TreeSpeciesDefinition>> = TREE_SPECIES_CATALOGUE,
): BatchWoodVolume {
  let treeCount = 0;
  let fellableCount = 0;
  let volumeDm3 = 0;
  for (const tree of trees) {
    if (tree.status === TreeStatus.FELLED) {
      continue;
    }
    treeCount += 1;
    if (!isFellable(tree, atGameMs, catalogue)) {
      continue;
    }
    fellableCount += 1;
    volumeDm3 += treeWoodVolumeDm3(tree, atGameMs, catalogue);
  }
  return { treeCount, fellableCount, volumeDm3, volumeM3: volumeDm3 / DM3_PER_M3 };
}

/** Wood produced by a batch felling, in cubic metres (GDD sections 135 and 138). */
export function batchWoodVolumeM3(
  trees: readonly TreeView[],
  atGameMs: GameMs,
  catalogue: Readonly<Record<TreeSpecies, TreeSpeciesDefinition>> = TREE_SPECIES_CATALOGUE,
): number {
  return batchWoodVolume(trees, atGameMs, catalogue).volumeM3;
}

/**
 * Expected volume per populated cell of a freshly bought forest, in cubic decimetres,
 * from the stage mix of the generator. It is the closed form of the estimate of GDD
 * section 138 and exists so that the balance report can state the figure without
 * generating a plot.
 */
export function expectedNaturalForestVolumeDm3(
  cellCount: number,
  params: NaturalForestParams,
  definition: TreeSpeciesDefinition,
  stageOrder: readonly TreeGrowthStage[] = TREE_GROWTH_STAGES,
): number {
  const cells = cellCount > 0 ? Math.floor(cellCount) : 0;
  let perCell = 0;
  for (const stage of stageOrder) {
    // Saplings carry no commercial value and cannot be felled (GDD section 131), so
    // they contribute nothing to the volume of a first clear cut.
    if (!definition.fellableStages.includes(stage)) {
      continue;
    }
    perCell += definition.woodVolumeDm3ByStage[stage] * params.stageMixBp[stage];
  }
  return (cells * params.treeDensityBp * perCell) / 100_000_000;
}
