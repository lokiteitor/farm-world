// Shape of a crop catalogue entry.
//
// Owner: workflow W2 (vocabulary). Sixty two annual crops (GDD sections 42, 82 and 86,
// with the expansion recorded in docs/erratas-gdd-stack.md).

import {
  CropCycleState,
  type CropFamily,
  type CropId,
  type CropLook,
  type Season,
  type StorageResource,
} from '../../domain/enums.js';
import { Money } from '../../domain/money.js';
import type { Bp, GameHours } from '../../domain/units.js';

/** The three states of the cycle that advance by elapsed time (GDD section 76). */
export type TimedCropCycleState = Extract<CropCycleState, 'SEEDED' | 'GERMINATING' | 'GROWING'>;

/**
 * The rates that belong to the land rather than to the harvest.
 *
 * They are split out because a field with no crop still has them: weeds still grow on
 * it and fertility still recovers while it lies fallow. Before this split the fallow
 * rates were read off the wheat entry, which made one crop of the catalogue a global
 * constant of the simulation (see `FALLOW_LAND`).
 */
export interface LandRates {
  /**
   * Weed growth while the field is in one of the states of `WEED_GROWTH_STATES`, in
   * basis points per game hour. 0.6 %/h is the literal value of GDD section 82 for
   * wheat; with the strict reading of finding H8 (weeds grow only during `GROWING`) it
   * yields 46.8 % at harvest over the 78 h growth phase, in the order of the ~20 % GDD
   * section 119 assumes, instead of saturating at 100 % over the whole cycle.
   */
  readonly weedGrowthBpPerGameHour: Bp;
  /**
   * Fertility recovered per game hour while the field lies fallow, that is while it is
   * `VIRGIN` (GDD section 77 admits fallow as the restoration route, plan section 2.2).
   * Never written by hand: `defineCrop` derives it from the drain, which is what keeps
   * one fallow cycle from restoring more than one harvested cycle takes away.
   */
  readonly fertilityRegenBpPerGameHourInFallow: Bp;
}

export interface CropDefinition extends LandRates {
  readonly id: CropId;
  /** Name shown by the interface, in Spanish and without diacritics. */
  readonly nameEs: string;
  /** Family, which is the key of the baseline this entry derives its defaults from. */
  readonly family: CropFamily;
  /** Silhouette the canvas draws this crop with. */
  readonly look: CropLook;
  /** Storage category the harvest goes into, and therefore the store it needs. */
  readonly storageResource: StorageResource;
  /**
   * Seasons in which the crop may be sown. Non empty.
   *
   * Only the instant of sowing is checked: a cycle that runs past the end of its window
   * is not penalised. The interest is in planning, since a long cycle sown late blocks
   * the field through the next window, and a penalty applied later would fall on a
   * player who was disconnected while it happened.
   */
  readonly sowingSeasons: readonly Season[];
  /**
   * Duration of each timed phase, in game hours. The GDD gives only the total
   * (`growthDuration: 96` in section 82) and one intermediate figure (6 h to germinate,
   * section 84), and section 118 needs the whole cycle to add up to about 325 h. Plan
   * section 2.2 resolves the indeterminacy with this split, which preserves both
   * published numbers; every other crop derives the same proportions from its own total.
   */
  readonly phaseDurationsGameHours: Readonly<Record<TimedCropCycleState, GameHours>>;
  /** Sum of the phases. Equals `growthDuration` of GDD section 82. */
  readonly growthDurationGameHours: GameHours;
  /** Litres per cell before any multiplier (GDD sections 82 and 119). */
  readonly baseYieldPerCellLiters: number;
  /**
   * Fixed sale price, no fluctuation in the MVP (GDD sections 82, 119 and 123).
   * The 0.22 of GDD section 82 is replaced by the balance revision of 2026-08: with
   * the literal catalogue the best possible cycle earned 4 950 against a holding cost
   * above 25 000, and the report in docs/balance concluded the sale price was the
   * most disproportionate constant. See docs/balance/informe-para-revision.md. Every
   * price added afterwards is set on that revised scale and not on the published one.
   */
  readonly sellPricePerLiter: Money;
  /**
   * Whether the crop needs `CULTIVATED` before being sown. False for wheat (GDD
   * sections 76 and 82), which makes `CULTIVATE` optional and turns it into a strategic
   * choice rather than a step: its only effect is resetting the weeds. True for the
   * families whose seed is too small or whose seedbed too fine to sow on plowed ground.
   */
  readonly requiresCultivation: boolean;
  /** Fertility lost per completed cycle (GDD sections 77 and 82). */
  readonly fertilityDrainPerCycleBp: Bp;
  /** State the field returns to after being harvested (GDD section 76). */
  readonly afterHarvestState: CropCycleState;
  /**
   * Seed cost per sown cell. Zero, and therefore inactive: GDD section 117 does not
   * cost the seed although the seeder sows from nothing. The field exists, together
   * with the reserved `SEED_PURCHASE` ledger kind, so that it is a lever available
   * without a migration (plan section 2.2).
   */
  readonly seedCostPerCell: Money;
}

/**
 * Everything a family fixes for its crops. Declared once per family and justified once
 * per family, which is how ADR-0014 is met without writing seven hundred comments: a
 * crop entry only states what makes it differ from its family.
 */
export interface CropFamilyBaseline {
  readonly look: CropLook;
  readonly storageResource: StorageResource;
  readonly sowingSeasons: readonly Season[];
  readonly requiresCultivation: boolean;
  readonly weedGrowthBpPerGameHour: Bp;
  readonly fertilityDrainPerCycleBp: Bp;
  readonly afterHarvestState: CropCycleState;
}

/** What a single crop states for itself, on top of its family baseline. */
export interface CropOverrides {
  readonly nameEs: string;
  /** Whole cycle from sowing to ready, in game hours. The phases derive from it. */
  readonly cycleGameHours: number;
  readonly baseYieldPerCellLiters: number;
  /** Written as a decimal string, which is how every price in this repository is read. */
  readonly sellPricePerLiter: string;
  readonly sowingSeasons?: readonly Season[];
  readonly requiresCultivation?: boolean;
  readonly weedGrowthBpPerGameHour?: Bp;
  readonly fertilityDrainPerCycleBp?: Bp;
}

/** Re-exported so consumers keep importing the cycle vocabulary from one place. */
export { CropCycleState, Money };
