// Procedural generation of an already populated wild forest (GDD sections 130 and 141).
//
// Owner: workflow W6-C. Module `forestry`.
//
// GDD section 130 says that buying forest for the first time produces a plot "generado
// proceduralmente ya poblado con arboles en distintas fases (mezcla coherente con un bosque
// salvaje)". Three properties follow from the rest of the design and shape every line here:
//
//   1. Deterministic from the seed and the coordinate, never from a random draw. The world is
//      procedurally persisted (GDD section 58, ADR-0010) and the very same integer hash that
//      classifies terrain classifies the trees, with salts of its own. There is no
//      `Math.random` anywhere in this file, for the same reason there is none in
//      `shared/world/terrain.ts`: a single random draw would make two runs of the same seed
//      disagree, and the test that recreates a plot would have nothing to assert.
//   2. A tree stores only when it was planted. The stage is never drawn and stored: the
//      generator draws a stage from the mix, then an age uniformly inside the window of that
//      stage, and writes `plantedAtGameMs = atGameMs - age`. Reading the stage back with
//      `treeStageAt` of `shared/rules/forestry.ts` therefore returns the stage that was drawn,
//      and it keeps returning the right one as the clock advances, with no event per tree
//      (plan section 6.5, ADR-0030).
//   3. Generation happens once per cell and never again. The caller marks
//      `world_cells.naturalTreeConsumed`, so deleting a plot and recreating it over the same
//      ground yields no trees at all (plan section 5.1). This file does not read that flag: it
//      generates what the cell would carry, and the caller decides which cells are eligible.
//
// Why the age is uniform inside the window rather than fixed at the middle. A forest whose
// trees all matured at the same instant would produce one milestone notification for the whole
// plot and then silence for 240 game hours, and the first felling would find every tree at the
// same volume. Spreading the ages is what makes `FOREST_NOTIFY_MILESTONE` report a trickle of
// maturing trees and what makes the volume of a batch a real sum rather than a multiplication.

import {
  DM3_PER_M3,
  NATURAL_FOREST,
  PINE,
  TREE_GROWTH_STAGES,
  TreeSpecies,
  addGameMs,
  gameHours,
  gameHoursToGameMs,
  hashGrid,
  type CellCoord,
  type GameMs,
  type NaturalForestParams,
  type TreeGrowthStage,
  type TreeSpeciesDefinition,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// Salts
// ---------------------------------------------------------------------------

/**
 * Salts of the three independent draws.
 *
 * Distinct odd constants, and deliberately far from the ones `shared/config/world.ts` gives
 * the noise octaves: two draws that shared a salt would be the same number, so the cells that
 * carry a tree would be exactly the cells whose tree is oldest.
 */
export const FOREST_SALT = {
  PRESENCE: 0x0f_0e_57_01,
  STAGE: 0x0f_0e_57_02,
  AGE: 0x0f_0e_57_03,
} as const;

/**
 * A hash of a cell as a fraction in `[0, 1)`.
 *
 * `hashGrid` of `shared/world/terrain.ts` and not a hash written here: it is the mixer the
 * terrain generator already runs on both sides of the cable, it folds the generator version in,
 * and `Math.imul` keeps it identical in Node and in a browser.
 */
export function forestUnitHash(
  seed: number,
  generatorVersion: number,
  cell: CellCoord,
  salt: number,
): number {
  return hashGrid(seed, generatorVersion, cell.cellX, cell.cellY, salt) / 4_294_967_296;
}

// ---------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------

/** A tree the generator decided a cell carries. Only the columns a row needs. */
export interface GeneratedTree extends CellCoord {
  readonly species: TreeSpecies;
  readonly plantedAtGameMs: GameMs;
  /** The stage the draw produced. Audit only: the row derives it back from the age. */
  readonly drawnStage: TreeGrowthStage;
  /** Age at the instant of generation, in game hours. Audit only, never stored. */
  readonly ageGameHours: number;
}

/**
 * The half open age window of a stage, in game hours.
 *
 * The last stage has no upper boundary in GDD section 131, where growth stops, so the
 * generator uses the explicit span of `NATURAL_FOREST.oldGrowthAgeSpanGameHours`. Only the
 * drawn age varies there: the volume is already stagnant.
 */
export function stageAgeWindow(
  stage: TreeGrowthStage,
  definition: TreeSpeciesDefinition,
  params: NaturalForestParams,
  stageOrder: readonly TreeGrowthStage[] = TREE_GROWTH_STAGES,
): { readonly fromGameHours: number; readonly toGameHours: number } {
  const index = stageOrder.indexOf(stage);
  const from = definition.stageStartGameHours[stage];
  const next = index === -1 ? undefined : stageOrder[index + 1];
  const to =
    next === undefined
      ? from + params.oldGrowthAgeSpanGameHours
      : definition.stageStartGameHours[next];
  return { fromGameHours: from, toGameHours: to };
}

/**
 * The stage a draw in `[0, 1)` selects from the mix.
 *
 * Cumulative over the published order of `TREE_GROWTH_STAGES`, so the distribution is the one
 * of `shared/config/forestry.ts` and the order is the one the vocabulary declares. The last
 * stage absorbs any rounding remainder, which is what makes the function total for a mix whose
 * basis points do not add up to exactly ten thousand.
 */
export function stageForDraw(
  draw: number,
  params: NaturalForestParams,
  stageOrder: readonly TreeGrowthStage[] = TREE_GROWTH_STAGES,
): TreeGrowthStage {
  const last = stageOrder[stageOrder.length - 1];
  if (last === undefined) {
    throw new RangeError('The stage order cannot be empty');
  }
  const threshold = draw * 10_000;
  let cumulative = 0;
  for (const stage of stageOrder) {
    cumulative += params.stageMixBp[stage];
    if (threshold < cumulative) {
      return stage;
    }
  }
  return last;
}

/**
 * The tree a cell carries in a freshly generated forest, or null when the cell is empty.
 *
 * `atGameMs` is the instant the plot is created, which is the only thing that is not a
 * function of the seed and the coordinate: the age is drawn and the planting instant is that
 * age before now, so a forest bought later is the same forest, just anchored later. That is
 * what makes the mix reproducible while keeping the stage a derived attribute.
 */
export function naturalTreeAt(
  seed: number,
  generatorVersion: number,
  cell: CellCoord,
  atGameMs: GameMs,
  params: NaturalForestParams = NATURAL_FOREST,
  definition: TreeSpeciesDefinition = PINE,
): GeneratedTree | null {
  const presence = forestUnitHash(seed, generatorVersion, cell, FOREST_SALT.PRESENCE);
  if (presence * 10_000 >= params.treeDensityBp) {
    return null;
  }
  const stage = stageForDraw(
    forestUnitHash(seed, generatorVersion, cell, FOREST_SALT.STAGE),
    params,
  );
  const window = stageAgeWindow(stage, definition, params);
  const ageDraw = forestUnitHash(seed, generatorVersion, cell, FOREST_SALT.AGE);
  const ageGameHours = window.fromGameHours + ageDraw * (window.toGameHours - window.fromGameHours);
  const plantedAtGameMs = addGameMs(atGameMs, -gameHoursToGameMs(gameHours(ageGameHours)));
  return {
    cellX: cell.cellX,
    cellY: cell.cellY,
    species: TreeSpecies.PINE,
    plantedAtGameMs,
    drawnStage: stage,
    ageGameHours,
  };
}

/**
 * The trees a set of cells carries. Cells with no tree simply do not appear.
 *
 * The order of the answer follows the order of the cells given, so a caller that deduplicated
 * its selection in request order writes its rows in that same order and two runs produce
 * identical output down to the row order.
 */
export function generateNaturalForest(
  seed: number,
  generatorVersion: number,
  cells: readonly CellCoord[],
  atGameMs: GameMs,
  params: NaturalForestParams = NATURAL_FOREST,
  definition: TreeSpeciesDefinition = PINE,
): readonly GeneratedTree[] {
  const trees: GeneratedTree[] = [];
  for (const cell of cells) {
    const tree = naturalTreeAt(seed, generatorVersion, cell, atGameMs, params, definition);
    if (tree !== null) {
      trees.push(tree);
    }
  }
  return trees;
}

/**
 * Wood a set of generated trees would hold at the instant they were generated, in cubic
 * decimetres, counting only the stages GDD section 131 allows to be felled.
 *
 * Used by the tests to cross check the closed form of `expectedNaturalForestVolumeDm3`
 * against an actual generation, which is the only way to tell a mix that is right on paper
 * from one that the draw does not reproduce.
 */
export function generatedFellableVolumeDm3(
  trees: readonly GeneratedTree[],
  definition: TreeSpeciesDefinition = PINE,
): number {
  let volume = 0;
  for (const tree of trees) {
    if (!definition.fellableStages.includes(tree.drawnStage)) {
      continue;
    }
    volume += definition.woodVolumeDm3ByStage[tree.drawnStage];
  }
  return volume;
}

/** The same figure in cubic metres, which is the unit GDD section 138 publishes. */
export function generatedFellableVolumeM3(
  trees: readonly GeneratedTree[],
  definition: TreeSpeciesDefinition = PINE,
): number {
  return generatedFellableVolumeDm3(trees, definition) / DM3_PER_M3;
}
