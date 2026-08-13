// Crop catalogue.
//
// Owner: workflow W2 (vocabulary). One crop in the MVP (GDD sections 42 and 86).

import { CropCycleState, type CropId, type MachineType } from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { bp, gameHours, type Bp, type GameHours } from '../domain/units.js';

/** The three states of the cycle that advance by elapsed time (GDD section 76). */
export type TimedCropCycleState = Extract<CropCycleState, 'SEEDED' | 'GERMINATING' | 'GROWING'>;

export interface CropDefinition {
  readonly id: CropId;
  /**
   * Duration of each timed phase, in game hours. The GDD gives only the total
   * (`growthDuration: 96` in section 82) and one intermediate figure (6 h to
   * germinate, section 84), and section 118 needs the whole cycle to add up to
   * about 325 h. Plan section 2.2 resolves the indeterminacy with this split, which
   * preserves both published numbers.
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
   * most disproportionate constant. See docs/balance/informe-para-revision.md.
   */
  readonly sellPricePerLiter: Money;
  /**
   * Whether the crop needs `CULTIVATED` before being sown. False for wheat (GDD
   * sections 76 and 82), which makes `CULTIVATE` optional and turns it into a
   * strategic choice rather than a step: its only effect is resetting the weeds.
   */
  readonly requiresCultivation: boolean;
  /** Machinery the full cycle needs (GDD section 82). */
  readonly requiredMachinery: readonly MachineType[];
  /**
   * Weed growth while the field is in one of the states of `WEED_GROWTH_STATES`, in
   * basis points per game hour. 0.6 %/h is the literal value of GDD section 82; with
   * the strict reading of finding H8 (weeds grow only during `GROWING`) it yields
   * 46.8 % at harvest over the 78 h growth phase, in the order of the ~20 % GDD
   * section 119 assumes, instead of saturating at 100 % over the whole cycle.
   */
  readonly weedGrowthBpPerGameHour: Bp;
  /** Fertility lost per completed cycle (GDD sections 77 and 82). */
  readonly fertilityDrainPerCycleBp: Bp;
  /**
   * Fertility recovered per game hour while the field lies fallow, that is while it
   * is `VIRGIN` (GDD section 77 admits fallow as the restoration route, plan section
   * 2.2). Invented value: 1 500 basis points recovered over 300 game hours, so one
   * idle cycle restores what one harvested cycle drains. Without a restoration route
   * the MVP is irreversible and the player runs out of usable land in about six
   * cycles.
   */
  readonly fertilityRegenBpPerGameHourInFallow: Bp;
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

/** Wheat (GDD sections 82 and 119). */
export const WHEAT: CropDefinition = {
  id: 'WHEAT',
  phaseDurationsGameHours: {
    SEEDED: gameHours(6),
    GERMINATING: gameHours(12),
    GROWING: gameHours(78),
  },
  growthDurationGameHours: gameHours(96),
  baseYieldPerCellLiters: 90,
  sellPricePerLiter: Money.fromString('0.90'),
  requiresCultivation: false,
  requiredMachinery: ['PLOW', 'SEEDER', 'HARVESTER'],
  weedGrowthBpPerGameHour: bp(60),
  fertilityDrainPerCycleBp: bp(1500),
  fertilityRegenBpPerGameHourInFallow: bp(5),
  afterHarvestState: CropCycleState.VIRGIN,
  seedCostPerCell: Money.ZERO,
};

export const CROPS: Readonly<Record<CropId, CropDefinition>> = {
  WHEAT,
};
