// Culinary and medicinal herbs.
//
// Owner: workflow W2 (vocabulary). Four annual herbs. The shortest cycles in the game: coriander is ready in under two
// game days.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const CILANTRO: CropDefinition = defineCrop('CILANTRO', 'HERB', {
  nameEs: 'Cilantro',
  cycleGameHours: 44,
  baseYieldPerCellLiters: 60,
  sellPricePerLiter: '1.30',
});

export const PEREJIL: CropDefinition = defineCrop('PEREJIL', 'HERB', {
  nameEs: 'Perejil',
  cycleGameHours: 52,
  baseYieldPerCellLiters: 66,
  sellPricePerLiter: '1.23',
});

export const ALBAHACA: CropDefinition = defineCrop('ALBAHACA', 'HERB', {
  nameEs: 'Albahaca',
  cycleGameHours: 56,
  baseYieldPerCellLiters: 58,
  sellPricePerLiter: '1.42',
});

export const MANZANILLA: CropDefinition = defineCrop('MANZANILLA', 'HERB', {
  nameEs: 'Manzanilla',
  cycleGameHours: 72,
  baseYieldPerCellLiters: 45,
  sellPricePerLiter: '1.99',
});
