// The baseline of each crop family.
//
// Owner: workflow W2 (vocabulary).
//
// This file is the answer to ADR-0014 at the scale of sixty two crops. Writing eleven
// constants per crop would mean seven hundred invented numbers, each of which the ADR
// would require to be justified where it is written; nobody can review that, and a
// reviewer who cannot review it will not notice the one that is wrong. So the shape of
// a crop is declared once per family, justified here, and each entry states only what
// makes it differ: its cycle, its yield and its price.
//
// Wheat is the anchor and it is not a member like the others: its five published
// figures (GDD sections 82 and 119, revised in docs/balance/revision-2026-08.md) are
// fixed, the balance report and the golden tests are built on them, and the cereal
// baseline is written so that wheat comes out of it unchanged.

import { CropCycleState, type CropFamily } from '../../domain/enums.js';
import { bp } from '../../domain/units.js';
import type { CropFamilyBaseline } from './types.js';

/**
 * Gross revenue per cell and game hour that each family aims at, used to set the price
 * of its crops from their cycle and yield. Wheat gives the anchor: 90 L at 0.90 over
 * 96 h is 0.84375. It is documentation of how the prices in this directory were
 * chosen, and `crop-balance.test.ts` holds every crop inside a band around it, so a
 * crop that would dominate the catalogue fails the suite instead of reaching a player.
 *
 * The families are not equal on purpose. Forage is bulk and cheap; industrial and cut
 * flowers pay well and exhaust the soil; leafy and fruiting crops sit above cereals
 * because they are perishable and need a cold store built before they can be harvested
 * at all.
 */
export const FAMILY_GROSS_PER_CELL_GAME_HOUR: Readonly<Record<CropFamily, number>> = {
  CEREAL: 0.84375,
  LEGUME: 0.95,
  OILSEED: 1.0,
  INDUSTRIAL: 1.15,
  ROOT: 0.9,
  LEAFY: 1.05,
  FRUITING: 1.1,
  HERB: 1.05,
  FLOWER: 1.15,
  FORAGE: 0.62,
};

export const CROP_FAMILY_BASELINE: Readonly<Record<CropFamily, CropFamilyBaseline>> = {
  // Cereals and pseudocereals. The baseline is wheat itself (GDD section 82): sown on
  // plowed ground without cultivating, 0.6 %/h of weeds, 15 % of fertility per cycle.
  // The winter sown ones (barley, oats, rye, triticale) override the season.
  CEREAL: {
    look: 'SPIKE',
    storageResource: 'GRAIN_LITERS',
    sowingSeasons: ['SPRING', 'SUMMER'],
    requiresCultivation: false,
    weedGrowthBpPerGameHour: bp(60),
    fertilityDrainPerCycleBp: bp(1500),
    afterHarvestState: CropCycleState.VIRGIN,
  },
  // Pulses fix nitrogen, so they take far less fertility than they would by biomass
  // alone: 6 % against the 15 % of a cereal. That is the whole reason to grow them, and
  // it is what makes a rotation a decision rather than a flavour.
  LEGUME: {
    look: 'POD',
    storageResource: 'GRAIN_LITERS',
    sowingSeasons: ['SPRING', 'SUMMER'],
    requiresCultivation: false,
    weedGrowthBpPerGameHour: bp(70),
    fertilityDrainPerCycleBp: bp(600),
    afterHarvestState: CropCycleState.VIRGIN,
  },
  // Oilseeds have a small seed and need a fine seedbed, which is what makes
  // `CULTIVATE` mandatory here and optional for a cereal. They are hungry: 18 %.
  OILSEED: {
    look: 'HEAD',
    storageResource: 'GRAIN_LITERS',
    sowingSeasons: ['SPRING', 'SUMMER'],
    requiresCultivation: true,
    weedGrowthBpPerGameHour: bp(65),
    fertilityDrainPerCycleBp: bp(1800),
    afterHarvestState: CropCycleState.VIRGIN,
  },
  // Cotton and tobacco: long cycles, wide rows and the heaviest drain of the catalogue
  // at 22 %. They are sold raw, without the ginning and curing that would make them
  // worth more (that chain is deliberately out of scope).
  INDUSTRIAL: {
    look: 'BUSH',
    storageResource: 'INDUSTRIAL_LITERS',
    sowingSeasons: ['SPRING'],
    requiresCultivation: true,
    weedGrowthBpPerGameHour: bp(85),
    fertilityDrainPerCycleBp: bp(2200),
    afterHarvestState: CropCycleState.VIRGIN,
  },
  // Roots and bulbs. Wide rows leave open soil, so weeds run at 0.9 %/h, the highest of
  // the food crops, and lifting the root takes 17 % of the fertility with it.
  ROOT: {
    look: 'TUBER',
    storageResource: 'PRODUCE_LITERS',
    sowingSeasons: ['SPRING', 'AUTUMN'],
    requiresCultivation: true,
    weedGrowthBpPerGameHour: bp(90),
    fertilityDrainPerCycleBp: bp(1700),
    afterHarvestState: CropCycleState.VIRGIN,
  },
  // Leafy crops: short cycles in the cool half of the year, little biomass and so only
  // 9 % of drain. Their appeal is turnover, not margin per cycle.
  LEAFY: {
    look: 'ROSETTE',
    storageResource: 'PRODUCE_LITERS',
    sowingSeasons: ['AUTUMN', 'WINTER', 'SPRING'],
    requiresCultivation: true,
    weedGrowthBpPerGameHour: bp(80),
    fertilityDrainPerCycleBp: bp(900),
    afterHarvestState: CropCycleState.VIRGIN,
  },
  FRUITING: {
    look: 'BUSH',
    storageResource: 'PRODUCE_LITERS',
    sowingSeasons: ['SPRING', 'SUMMER'],
    requiresCultivation: true,
    weedGrowthBpPerGameHour: bp(85),
    fertilityDrainPerCycleBp: bp(1400),
    afterHarvestState: CropCycleState.VIRGIN,
  },
  // Herbs: the shortest cycles of the catalogue and the lightest drain after pulses.
  HERB: {
    look: 'BLOOM',
    storageResource: 'PRODUCE_LITERS',
    sowingSeasons: ['SPRING', 'SUMMER', 'AUTUMN'],
    requiresCultivation: true,
    weedGrowthBpPerGameHour: bp(75),
    fertilityDrainPerCycleBp: bp(700),
    afterHarvestState: CropCycleState.VIRGIN,
  },
  FLOWER: {
    look: 'BLOOM',
    storageResource: 'PRODUCE_LITERS',
    sowingSeasons: ['SPRING', 'SUMMER'],
    requiresCultivation: true,
    weedGrowthBpPerGameHour: bp(75),
    fertilityDrainPerCycleBp: bp(1100),
    afterHarvestState: CropCycleState.VIRGIN,
  },
  // Forage is cut whole for silage, so the yield per cell is the largest of the
  // catalogue and the price the smallest. It shares the cereal agronomy because that is
  // what it is: the same plants harvested green.
  FORAGE: {
    look: 'SPIKE',
    storageResource: 'FORAGE_LITERS',
    sowingSeasons: ['SPRING', 'SUMMER'],
    requiresCultivation: false,
    weedGrowthBpPerGameHour: bp(60),
    fertilityDrainPerCycleBp: bp(1300),
    afterHarvestState: CropCycleState.VIRGIN,
  },
};
