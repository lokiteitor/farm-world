// Cut flowers.
//
// Owner: workflow W2 (vocabulary). Five annual cut flowers. Marigold is sown for the autumn, tulip is lifted from a bulb
// planted in the cold.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const CEMPASUCHIL: CropDefinition = defineCrop('CEMPASUCHIL', 'FLOWER', {
  nameEs: 'Cempasuchil',
  cycleGameHours: 88,
  baseYieldPerCellLiters: 70,
  sellPricePerLiter: '1.40',
  sowingSeasons: ['SUMMER', 'AUTUMN'],
});

export const GIRASOL_ORNAMENTAL: CropDefinition = defineCrop('GIRASOL_ORNAMENTAL', 'FLOWER', {
  nameEs: 'Girasol ornamental',
  cycleGameHours: 100,
  baseYieldPerCellLiters: 62,
  sellPricePerLiter: '1.72',
});

export const CRISANTEMO: CropDefinition = defineCrop('CRISANTEMO', 'FLOWER', {
  nameEs: 'Crisantemo',
  cycleGameHours: 112,
  baseYieldPerCellLiters: 58,
  sellPricePerLiter: '2.00',
});

export const TULIPAN: CropDefinition = defineCrop('TULIPAN', 'FLOWER', {
  nameEs: 'Tulipan',
  cycleGameHours: 96,
  baseYieldPerCellLiters: 48,
  sellPricePerLiter: '2.16',
  sowingSeasons: ['AUTUMN', 'WINTER'],
});

export const DALIA: CropDefinition = defineCrop('DALIA', 'FLOWER', {
  nameEs: 'Dalia',
  cycleGameHours: 104,
  baseYieldPerCellLiters: 52,
  sellPricePerLiter: '2.11',
});
