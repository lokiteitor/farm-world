// Leafy vegetables.
//
// Owner: workflow W2 (vocabulary). Six leafy vegetables, the fastest food crops of the catalogue.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const LECHUGA: CropDefinition = defineCrop('LECHUGA', 'LEAFY', {
  nameEs: 'Lechuga',
  cycleGameHours: 56,
  baseYieldPerCellLiters: 140,
  sellPricePerLiter: '0.59',
});

export const ESPINACA: CropDefinition = defineCrop('ESPINACA', 'LEAFY', {
  nameEs: 'Espinaca',
  cycleGameHours: 52,
  baseYieldPerCellLiters: 120,
  sellPricePerLiter: '0.68',
});

export const ACELGA: CropDefinition = defineCrop('ACELGA', 'LEAFY', {
  nameEs: 'Acelga',
  cycleGameHours: 60,
  baseYieldPerCellLiters: 130,
  sellPricePerLiter: '0.66',
});

export const COL: CropDefinition = defineCrop('COL', 'LEAFY', {
  nameEs: 'Col',
  cycleGameHours: 88,
  baseYieldPerCellLiters: 190,
  sellPricePerLiter: '0.53',
});

export const COLIFLOR: CropDefinition = defineCrop('COLIFLOR', 'LEAFY', {
  nameEs: 'Coliflor',
  cycleGameHours: 96,
  baseYieldPerCellLiters: 160,
  sellPricePerLiter: '0.66',
});

export const BROCOLI: CropDefinition = defineCrop('BROCOLI', 'LEAFY', {
  nameEs: 'Brocoli',
  cycleGameHours: 92,
  baseYieldPerCellLiters: 150,
  sellPricePerLiter: '0.69',
});
