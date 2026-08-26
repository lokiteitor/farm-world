// Forage crops.
//
// Owner: workflow W2 (vocabulary). Four forage crops: the same plants as their grain counterparts, cut whole and green.
// Bulk and cheap, and they need a hay barn rather than a silo.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const MAIZ_FORRAJERO: CropDefinition = defineCrop('MAIZ_FORRAJERO', 'FORAGE', {
  nameEs: 'Maiz forrajero',
  cycleGameHours: 120,
  baseYieldPerCellLiters: 320,
  sellPricePerLiter: '0.29',
});

export const SORGO_FORRAJERO: CropDefinition = defineCrop('SORGO_FORRAJERO', 'FORAGE', {
  nameEs: 'Sorgo forrajero',
  cycleGameHours: 112,
  baseYieldPerCellLiters: 300,
  // Un centimo por encima de lo que la calibracion pedia: a 0,29 el ciclo dejaba 18 $, que
  // es cero con otro nombre, y el redondeo a dos decimales no da nada entre medias.
  sellPricePerLiter: '0.30',
});

export const AVENA_FORRAJERA: CropDefinition = defineCrop('AVENA_FORRAJERA', 'FORAGE', {
  nameEs: 'Avena forrajera',
  cycleGameHours: 84,
  baseYieldPerCellLiters: 240,
  sellPricePerLiter: '0.32',
  sowingSeasons: ['AUTUMN', 'WINTER'],
});

export const CENTENO_FORRAJERO: CropDefinition = defineCrop('CENTENO_FORRAJERO', 'FORAGE', {
  nameEs: 'Centeno forrajero',
  cycleGameHours: 92,
  baseYieldPerCellLiters: 250,
  sellPricePerLiter: '0.32',
  sowingSeasons: ['AUTUMN', 'WINTER'],
});
