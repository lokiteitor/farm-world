// Pulses.
//
// Owner: workflow W2 (vocabulary). Seven pulses. They pay better per litre than a cereal and take a quarter of the
// fertility, which is the rotation lever of the catalogue. Lentil, pea and broad bean
// carry the winter.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const FRIJOL: CropDefinition = defineCrop('FRIJOL', 'LEGUME', {
  nameEs: 'Frijol',
  cycleGameHours: 112,
  baseYieldPerCellLiters: 72,
  sellPricePerLiter: '1.33',
});

export const GARBANZO: CropDefinition = defineCrop('GARBANZO', 'LEGUME', {
  nameEs: 'Garbanzo',
  cycleGameHours: 120,
  baseYieldPerCellLiters: 68,
  sellPricePerLiter: '1.49',
});

export const LENTEJA: CropDefinition = defineCrop('LENTEJA', 'LEGUME', {
  nameEs: 'Lenteja',
  cycleGameHours: 116,
  baseYieldPerCellLiters: 60,
  sellPricePerLiter: '1.65',
  sowingSeasons: ['AUTUMN', 'WINTER'],
});

export const CHICHARO: CropDefinition = defineCrop('CHICHARO', 'LEGUME', {
  nameEs: 'Chicharo',
  cycleGameHours: 84,
  baseYieldPerCellLiters: 74,
  sellPricePerLiter: '1.08',
  sowingSeasons: ['AUTUMN', 'WINTER'],
});

export const HABA: CropDefinition = defineCrop('HABA', 'LEGUME', {
  nameEs: 'Haba',
  cycleGameHours: 108,
  baseYieldPerCellLiters: 88,
  sellPricePerLiter: '1.06',
  sowingSeasons: ['AUTUMN', 'WINTER'],
});

export const SOYA: CropDefinition = defineCrop('SOYA', 'LEGUME', {
  nameEs: 'Soya',
  cycleGameHours: 140,
  baseYieldPerCellLiters: 96,
  sellPricePerLiter: '1.23',
});

export const CACAHUATE: CropDefinition = defineCrop('CACAHUATE', 'LEGUME', {
  nameEs: 'Cacahuate',
  cycleGameHours: 152,
  baseYieldPerCellLiters: 78,
  sellPricePerLiter: '1.65',
});
