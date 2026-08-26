// Roots, tubers and bulbs.
//
// Owner: workflow W2 (vocabulary). Eight roots and bulbs. High yield per cell at a low price per litre, and all of them
// need a cold store before a single cell can be harvested. Garlic and onion overwinter.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const PAPA: CropDefinition = defineCrop('PAPA', 'ROOT', {
  nameEs: 'Papa',
  cycleGameHours: 120,
  baseYieldPerCellLiters: 260,
  sellPricePerLiter: '0.54',
});

export const JICAMA: CropDefinition = defineCrop('JICAMA', 'ROOT', {
  nameEs: 'Jicama',
  cycleGameHours: 132,
  baseYieldPerCellLiters: 210,
  sellPricePerLiter: '0.76',
});

export const BETABEL: CropDefinition = defineCrop('BETABEL', 'ROOT', {
  nameEs: 'Betabel',
  cycleGameHours: 108,
  baseYieldPerCellLiters: 230,
  sellPricePerLiter: '0.55',
});

export const ZANAHORIA: CropDefinition = defineCrop('ZANAHORIA', 'ROOT', {
  nameEs: 'Zanahoria',
  cycleGameHours: 96,
  baseYieldPerCellLiters: 240,
  sellPricePerLiter: '0.47',
});

export const RABANO: CropDefinition = defineCrop('RABANO', 'ROOT', {
  nameEs: 'Rabano',
  cycleGameHours: 48,
  baseYieldPerCellLiters: 130,
  sellPricePerLiter: '0.62',
});

export const CHIRIVIA: CropDefinition = defineCrop('CHIRIVIA', 'ROOT', {
  nameEs: 'Chirivia',
  cycleGameHours: 116,
  baseYieldPerCellLiters: 190,
  sellPricePerLiter: '0.72',
});

export const CEBOLLA: CropDefinition = defineCrop('CEBOLLA', 'ROOT', {
  nameEs: 'Cebolla',
  cycleGameHours: 128,
  baseYieldPerCellLiters: 220,
  sellPricePerLiter: '0.69',
  sowingSeasons: ['AUTUMN', 'WINTER'],
});

export const AJO: CropDefinition = defineCrop('AJO', 'ROOT', {
  nameEs: 'Ajo',
  cycleGameHours: 152,
  baseYieldPerCellLiters: 120,
  sellPricePerLiter: '1.42',
  sowingSeasons: ['AUTUMN', 'WINTER'],
});
