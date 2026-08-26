// Builder of a crop catalogue entry.
//
// Owner: workflow W2 (vocabulary).
//
// Everything a crop can derive from something else is derived here rather than written
// down, which is what keeps sixty two entries reviewable and what makes two of the
// catalogue invariants true by construction instead of by inspection.

import type { CropFamily, CropId } from '../../domain/enums.js';
import { Money } from '../../domain/money.js';
import { bp, gameHours, type Bp, type GameHours } from '../../domain/units.js';
import { CROP_FAMILY_BASELINE } from './families.js';
import type { CropDefinition, CropOverrides, TimedCropCycleState } from './types.js';

/**
 * How the cycle splits across the three timed phases, in basis points.
 *
 * These are wheat's own proportions: 6, 12 and 78 game hours out of 96 (GDD sections 82
 * and 84, split by plan section 2.2). Applying them to every crop means a longer cycle
 * is longer in the same shape, and it means wheat comes back out of the builder with
 * exactly the numbers it went in with.
 */
const PHASE_SPLIT_BP: Readonly<Record<TimedCropCycleState, number>> = {
  SEEDED: 625,
  GERMINATING: 1250,
  GROWING: 8125,
};

/**
 * Game hours a fallow cycle is measured over when deriving the regeneration rate.
 *
 * Deliberately 300 and not the 325 of GDD section 118. The catalogue invariant is that
 * one fallow cycle restores at most one harvested cycle's drain plus a tenth
 * (`catalog.test.ts`), so dividing by 300 satisfies it by algebra for any family, since
 * 325/300 is 1.083 and the bound is 1.1. It also reproduces wheat exactly: 1500 basis
 * points over 300 hours is the 5 bp/h the catalogue published by hand.
 */
const FALLOW_REFERENCE_GAME_HOURS = 300;

/** The regeneration rate a drain implies. Never written by hand. */
export function fallowRegenBpPerGameHour(drainPerCycleBp: Bp): Bp {
  const derived = Math.floor((drainPerCycleBp as number) / FALLOW_REFERENCE_GAME_HOURS);
  return bp(derived > 0 ? derived : 1);
}

/** The three phase durations a whole cycle implies. They always add up to the cycle. */
export function phaseDurations(
  cycleGameHours: number,
): Readonly<Record<TimedCropCycleState, GameHours>> {
  const seeded = Math.floor((cycleGameHours * PHASE_SPLIT_BP.SEEDED) / 10_000);
  const germinating = Math.floor((cycleGameHours * PHASE_SPLIT_BP.GERMINATING) / 10_000);
  // The last phase absorbs the rounding, so the sum is the published total exactly.
  const growing = cycleGameHours - seeded - germinating;
  if (seeded <= 0 || germinating <= 0 || growing <= 0) {
    throw new RangeError(
      `A cycle of ${cycleGameHours} game hours does not split into three phases`,
    );
  }
  return {
    SEEDED: gameHours(seeded),
    GERMINATING: gameHours(germinating),
    GROWING: gameHours(growing),
  };
}

/** Builds one entry from its family baseline plus what the crop states for itself. */
export function defineCrop(
  id: CropId,
  family: CropFamily,
  overrides: CropOverrides,
): CropDefinition {
  const baseline = CROP_FAMILY_BASELINE[family];
  const drain = overrides.fertilityDrainPerCycleBp ?? baseline.fertilityDrainPerCycleBp;
  const durations = phaseDurations(overrides.cycleGameHours);
  return {
    id,
    nameEs: overrides.nameEs,
    family,
    look: baseline.look,
    storageResource: baseline.storageResource,
    sowingSeasons: overrides.sowingSeasons ?? baseline.sowingSeasons,
    phaseDurationsGameHours: durations,
    growthDurationGameHours: gameHours(overrides.cycleGameHours),
    baseYieldPerCellLiters: overrides.baseYieldPerCellLiters,
    sellPricePerLiter: Money.fromString(overrides.sellPricePerLiter),
    requiresCultivation: overrides.requiresCultivation ?? baseline.requiresCultivation,
    weedGrowthBpPerGameHour: overrides.weedGrowthBpPerGameHour ?? baseline.weedGrowthBpPerGameHour,
    fertilityDrainPerCycleBp: drain,
    fertilityRegenBpPerGameHourInFallow: fallowRegenBpPerGameHour(drain),
    afterHarvestState: baseline.afterHarvestState,
    seedCostPerCell: Money.ZERO,
  };
}
