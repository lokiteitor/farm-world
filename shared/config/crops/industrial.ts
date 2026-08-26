// Industrial crops.
//
// Owner: workflow W2 (vocabulary). Cotton and tobacco, sold raw. Ginning and curing are out of scope, so these are the
// longest cycles of the catalogue paid at the raw price.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const ALGODON: CropDefinition = defineCrop('ALGODON', 'INDUSTRIAL', {
  nameEs: 'Algodon',
  cycleGameHours: 176,
  baseYieldPerCellLiters: 64,
  sellPricePerLiter: '2.78',
});

export const TABACO: CropDefinition = defineCrop('TABACO', 'INDUSTRIAL', {
  nameEs: 'Tabaco',
  cycleGameHours: 160,
  baseYieldPerCellLiters: 70,
  sellPricePerLiter: '2.48',
});
