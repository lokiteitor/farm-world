// Tree species catalogue and natural forest generation.
//
// Owner: workflow W2 (vocabulary). One species in the MVP (GDD sections 133 and 141).

import { TreeGrowthStage, type MachineType, type TreeSpecies } from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { bp, gameHours, type Bp, type GameHours } from '../domain/units.js';

export interface TreeSpeciesDefinition {
  readonly species: TreeSpecies;
  /** Duration of each stage (GDD section 133). */
  readonly growthDurationPerStageGameHours: GameHours;
  /**
   * Age, in game hours, at which each stage begins. Four stages have three
   * boundaries, so `SAPLING` starts at zero: GDD section 133 multiplies the 240 h of a
   * stage by four and reads 960 h to reach `OLD_GROWTH`, but the fourth stage is the
   * one already reached, so the boundary is at 720 h. The 960 h figure is documented as
   * a misreading (plan section 2.2), and it is also what GDD section 133 uses to call
   * the forestry cycle three times longer than the 325 h agricultural one; at 720 h it
   * is still more than twice as long, so the design intent holds.
   */
  readonly stageStartGameHours: Readonly<Record<TreeGrowthStage, GameHours>>;
  /**
   * Wood volume per stage, in cubic decimetres (GDD section 131, which publishes 0.05,
   * 0.4, 1.8 and 2.5 m³). Integers so that a batch volume is the exact sum of counts
   * per stage times volume per stage.
   */
  readonly woodVolumeDm3ByStage: Readonly<Record<TreeGrowthStage, number>>;
  /** Maximum volume, reached at `OLD_GROWTH`, where growth stops (GDD sections 131, 133). */
  readonly maxWoodVolumeDm3: number;
  /** Fixed sale price per cubic metre (GDD section 133). */
  readonly sellPricePerM3: Money;
  /** Stages that may be felled. `SAPLING` may not (GDD section 131). */
  readonly fellableStages: readonly TreeGrowthStage[];
  /** Machinery the cycle needs (GDD sections 133 and 134). */
  readonly requiredMachinery: readonly MachineType[];
}

/** Pine (GDD sections 131, 133 and 134). */
export const PINE: TreeSpeciesDefinition = {
  species: 'PINE',
  growthDurationPerStageGameHours: gameHours(240),
  stageStartGameHours: {
    SAPLING: gameHours(0),
    YOUNG: gameHours(240),
    MATURE: gameHours(480),
    OLD_GROWTH: gameHours(720),
  },
  woodVolumeDm3ByStage: {
    SAPLING: 50,
    YOUNG: 400,
    MATURE: 1800,
    OLD_GROWTH: 2500,
  },
  maxWoodVolumeDm3: 2500,
  sellPricePerM3: Money.fromUnits(45),
  fellableStages: [TreeGrowthStage.YOUNG, TreeGrowthStage.MATURE, TreeGrowthStage.OLD_GROWTH],
  requiredMachinery: ['HARVESTER_FORESTRY', 'FORWARDER'],
};

export const TREE_SPECIES_CATALOGUE: Readonly<Record<TreeSpecies, TreeSpeciesDefinition>> = {
  PINE,
};

/**
 * Generation of a forest that is already populated, which is how a forest arrives when
 * it is first bought (GDD sections 130 and 141).
 *
 * The mix is what reproduces the order of magnitude of GDD section 138: 250 cells with
 * one tree each and an average volume of 1.534 m³ give 383.5 m³, against the 382 m³ that
 * GDD section 138 estimates as "250 trees times about 1.8 m³ times 0.85". The mix is
 * therefore not a free invention: it is the distribution that makes the published figure
 * come out, weighted towards mature trees as a wild forest is.
 *
 * The generator draws a stage from this distribution and then an age uniformly inside the
 * window of that stage, because the stage is always derived from the age and never stored.
 */
export interface NaturalForestParams {
  /**
   * Share of forest cells that carry a tree, in basis points. GDD section 138 counts 250
   * trees on 250 cells, so every cell carries one; GDD section 130 still allows a cell to
   * be empty, which is what a cell that was felled and not replanted becomes.
   */
  readonly treeDensityBp: Bp;
  /** Distribution of stages at generation time. Sums to 10 000 basis points. */
  readonly stageMixBp: Readonly<Record<TreeGrowthStage, Bp>>;
  /**
   * Width of the age window used for `OLD_GROWTH`, which has no upper boundary. Only the
   * drawn age varies: the volume is already stagnant there (GDD section 131).
   */
  readonly oldGrowthAgeSpanGameHours: GameHours;
}

export const NATURAL_FOREST: NaturalForestParams = {
  treeDensityBp: bp(10_000),
  stageMixBp: {
    SAPLING: bp(800),
    YOUNG: bp(2000),
    MATURE: bp(5000),
    OLD_GROWTH: bp(2200),
  },
  oldGrowthAgeSpanGameHours: gameHours(240),
};

/**
 * Stages whose arrival is worth a notification and a line in the return summary. Only
 * maturity: GDD section 131 is explicit that nothing is lost by not felling on time, so a
 * milestone is information and never a deadline.
 */
export const FOREST_MILESTONE_STAGES: readonly TreeGrowthStage[] = [TreeGrowthStage.MATURE];

/**
 * Average volume of a generated forest, in cubic decimetres per populated cell. Derived
 * from the mix, and checked by the coherence test against the estimate of GDD section 138.
 */
export const NATURAL_FOREST_AVERAGE_VOLUME_DM3 =
  (PINE.woodVolumeDm3ByStage.SAPLING * NATURAL_FOREST.stageMixBp.SAPLING +
    PINE.woodVolumeDm3ByStage.YOUNG * NATURAL_FOREST.stageMixBp.YOUNG +
    PINE.woodVolumeDm3ByStage.MATURE * NATURAL_FOREST.stageMixBp.MATURE +
    PINE.woodVolumeDm3ByStage.OLD_GROWTH * NATURAL_FOREST.stageMixBp.OLD_GROWTH) /
  10_000;
