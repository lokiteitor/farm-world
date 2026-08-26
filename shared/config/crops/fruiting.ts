// Fruiting vegetables.
//
// Owner: workflow W2 (vocabulary). Eleven fruiting vegetables. Green bean is the same plant as the dry bean, harvested
// as a pod instead of as grain, which is why it appears here and not among the pulses.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const PEPINO: CropDefinition = defineCrop('PEPINO', 'FRUITING', {
  nameEs: 'Pepino',
  cycleGameHours: 72,
  baseYieldPerCellLiters: 180,
  sellPricePerLiter: '0.51',
});

export const CALABACITA: CropDefinition = defineCrop('CALABACITA', 'FRUITING', {
  nameEs: 'Calabacita',
  cycleGameHours: 64,
  baseYieldPerCellLiters: 165,
  sellPricePerLiter: '0.53',
});

export const CALABAZA: CropDefinition = defineCrop('CALABAZA', 'FRUITING', {
  nameEs: 'Calabaza',
  cycleGameHours: 120,
  baseYieldPerCellLiters: 210,
  sellPricePerLiter: '0.64',
});

export const MELON: CropDefinition = defineCrop('MELON', 'FRUITING', {
  nameEs: 'Melon',
  cycleGameHours: 108,
  baseYieldPerCellLiters: 175,
  sellPricePerLiter: '0.70',
});

export const SANDIA: CropDefinition = defineCrop('SANDIA', 'FRUITING', {
  nameEs: 'Sandia',
  cycleGameHours: 116,
  baseYieldPerCellLiters: 200,
  sellPricePerLiter: '0.65',
});

export const BERENJENA: CropDefinition = defineCrop('BERENJENA', 'FRUITING', {
  nameEs: 'Berenjena',
  cycleGameHours: 100,
  baseYieldPerCellLiters: 150,
  sellPricePerLiter: '0.76',
});

export const TOMATE: CropDefinition = defineCrop('TOMATE', 'FRUITING', {
  nameEs: 'Tomate',
  cycleGameHours: 104,
  baseYieldPerCellLiters: 195,
  sellPricePerLiter: '0.60',
});

export const TOMATILLO: CropDefinition = defineCrop('TOMATILLO', 'FRUITING', {
  nameEs: 'Tomatillo',
  cycleGameHours: 92,
  baseYieldPerCellLiters: 170,
  sellPricePerLiter: '0.63',
});

export const CHILE: CropDefinition = defineCrop('CHILE', 'FRUITING', {
  nameEs: 'Chile',
  cycleGameHours: 112,
  baseYieldPerCellLiters: 125,
  sellPricePerLiter: '1.00',
});

export const PIMIENTO: CropDefinition = defineCrop('PIMIENTO', 'FRUITING', {
  nameEs: 'Pimiento',
  cycleGameHours: 108,
  baseYieldPerCellLiters: 135,
  sellPricePerLiter: '0.91',
});

export const EJOTE: CropDefinition = defineCrop('EJOTE', 'FRUITING', {
  nameEs: 'Ejote',
  cycleGameHours: 80,
  baseYieldPerCellLiters: 95,
  sellPricePerLiter: '1.02',
});
