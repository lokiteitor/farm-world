// Cereals and pseudocereals.
//
// Owner: workflow W2 (vocabulary). The ten cereals. Wheat is the anchor of the whole catalogue and its five published
// figures (GDD sections 82 and 119) are reproduced exactly by the cereal baseline.
// Barley, oats, rye and triticale are autumn sown, which is what gives the cold half
// of the year a grain to grow.
//
// Only what differs from the family baseline is written here; everything else comes
// from `families.ts` through `defineCrop`.

import { defineCrop } from './defineCrop.js';
import type { CropDefinition } from './types.js';

export const MAIZ: CropDefinition = defineCrop('MAIZ', 'CEREAL', {
  nameEs: 'Maiz',
  cycleGameHours: 168,
  baseYieldPerCellLiters: 150,
  sellPricePerLiter: '0.84',
});

export const WHEAT: CropDefinition = defineCrop('WHEAT', 'CEREAL', {
  nameEs: 'Trigo',
  cycleGameHours: 96,
  baseYieldPerCellLiters: 90,
  sellPricePerLiter: '0.90',
});

export const CEBADA: CropDefinition = defineCrop('CEBADA', 'CEREAL', {
  nameEs: 'Cebada',
  cycleGameHours: 88,
  baseYieldPerCellLiters: 82,
  sellPricePerLiter: '0.95',
  sowingSeasons: ['AUTUMN', 'SPRING'],
});

export const AVENA: CropDefinition = defineCrop('AVENA', 'CEREAL', {
  nameEs: 'Avena',
  cycleGameHours: 92,
  baseYieldPerCellLiters: 85,
  sellPricePerLiter: '0.94',
  sowingSeasons: ['AUTUMN', 'SPRING'],
});

export const CENTENO: CropDefinition = defineCrop('CENTENO', 'CEREAL', {
  nameEs: 'Centeno',
  cycleGameHours: 100,
  baseYieldPerCellLiters: 88,
  sellPricePerLiter: '0.94',
  sowingSeasons: ['AUTUMN', 'WINTER'],
});

export const SORGO: CropDefinition = defineCrop('SORGO', 'CEREAL', {
  nameEs: 'Sorgo',
  cycleGameHours: 144,
  baseYieldPerCellLiters: 130,
  sellPricePerLiter: '0.83',
});

export const TRITICALE: CropDefinition = defineCrop('TRITICALE', 'CEREAL', {
  nameEs: 'Triticale',
  cycleGameHours: 104,
  baseYieldPerCellLiters: 95,
  sellPricePerLiter: '0.89',
  sowingSeasons: ['AUTUMN', 'SPRING'],
});

export const MIJO: CropDefinition = defineCrop('MIJO', 'CEREAL', {
  nameEs: 'Mijo',
  cycleGameHours: 80,
  baseYieldPerCellLiters: 66,
  sellPricePerLiter: '1.14',
});

export const QUINOA: CropDefinition = defineCrop('QUINOA', 'CEREAL', {
  nameEs: 'Quinoa',
  cycleGameHours: 132,
  baseYieldPerCellLiters: 70,
  sellPricePerLiter: '1.43',
});

export const AMARANTO: CropDefinition = defineCrop('AMARANTO', 'CEREAL', {
  nameEs: 'Amaranto',
  cycleGameHours: 124,
  baseYieldPerCellLiters: 64,
  sellPricePerLiter: '1.49',
});
