// Oilseeds.
//
// Owner: workflow W2 (vocabulary). Five oilseeds, sold as seed: the pressing chain is deliberately out of scope, so the
// price is the seed price and not the oil price.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const CANOLA: CropDefinition = defineCrop('CANOLA', 'OILSEED', {
  nameEs: 'Canola',
  cycleGameHours: 128,
  baseYieldPerCellLiters: 82,
  sellPricePerLiter: '1.43',
  sowingSeasons: ['AUTUMN'],
});

export const GIRASOL: CropDefinition = defineCrop('GIRASOL', 'OILSEED', {
  nameEs: 'Girasol',
  cycleGameHours: 136,
  baseYieldPerCellLiters: 90,
  sellPricePerLiter: '1.38',
});

export const AJONJOLI: CropDefinition = defineCrop('AJONJOLI', 'OILSEED', {
  nameEs: 'Ajonjoli',
  cycleGameHours: 120,
  baseYieldPerCellLiters: 52,
  sellPricePerLiter: '2.15',
});

export const LINAZA: CropDefinition = defineCrop('LINAZA', 'OILSEED', {
  nameEs: 'Linaza',
  cycleGameHours: 112,
  baseYieldPerCellLiters: 56,
  sellPricePerLiter: '1.89',
  sowingSeasons: ['SPRING'],
});

export const MOSTAZA: CropDefinition = defineCrop('MOSTAZA', 'OILSEED', {
  nameEs: 'Mostaza',
  cycleGameHours: 96,
  baseYieldPerCellLiters: 58,
  sellPricePerLiter: '1.66',
  sowingSeasons: ['AUTUMN', 'SPRING'],
});
