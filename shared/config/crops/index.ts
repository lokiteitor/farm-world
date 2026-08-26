// The crop catalogue.
//
// Owner: workflow W2 (vocabulary). Sixty two annual crops of a single destructive
// harvest, grouped into ten families (GDD sections 42, 82 and 86; the expansion beyond
// the one crop of the MVP is recorded in docs/erratas-gdd-stack.md).
//
// The catalogue stays a TypeScript constant rather than a table, as ADR-0011 decided,
// because the player does not unlock crops: it is still global configuration and not
// per player state. What ADR-0011 asked to watch for was the second crop, and the
// answer at sixty two is `families.ts`: one justified baseline per family, and one line
// per crop stating its cycle, its yield and its price.

export * from './cereals.js';
export * from './legumes.js';
export * from './oilseeds.js';
export * from './industrial.js';
export * from './roots.js';
export * from './leafy.js';
export * from './fruiting.js';
export * from './herbs.js';
export * from './flowers.js';
export * from './forage.js';
export * from './types.js';
export { CROP_FAMILY_BASELINE, FAMILY_GROSS_PER_CELL_GAME_HOUR } from './families.js';
export { defineCrop, fallowRegenBpPerGameHour, phaseDurations } from './defineCrop.js';
export { FALLOW_LAND } from './fallow.js';

import type { CropId } from '../../domain/enums.js';
import {
  MAIZ,
  WHEAT,
  CEBADA,
  AVENA,
  CENTENO,
  SORGO,
  TRITICALE,
  MIJO,
  QUINOA,
  AMARANTO,
} from './cereals.js';
import { CEMPASUCHIL, GIRASOL_ORNAMENTAL, CRISANTEMO, TULIPAN, DALIA } from './flowers.js';
import { MAIZ_FORRAJERO, SORGO_FORRAJERO, AVENA_FORRAJERA, CENTENO_FORRAJERO } from './forage.js';
import {
  PEPINO,
  CALABACITA,
  CALABAZA,
  MELON,
  SANDIA,
  BERENJENA,
  TOMATE,
  TOMATILLO,
  CHILE,
  PIMIENTO,
  EJOTE,
} from './fruiting.js';
import { CILANTRO, PEREJIL, ALBAHACA, MANZANILLA } from './herbs.js';
import { ALGODON, TABACO } from './industrial.js';
import { LECHUGA, ESPINACA, ACELGA, COL, COLIFLOR, BROCOLI } from './leafy.js';
import { FRIJOL, GARBANZO, LENTEJA, CHICHARO, HABA, SOYA, CACAHUATE } from './legumes.js';
import { CANOLA, GIRASOL, AJONJOLI, LINAZA, MOSTAZA } from './oilseeds.js';
import { PAPA, JICAMA, BETABEL, ZANAHORIA, RABANO, CHIRIVIA, CEBOLLA, AJO } from './roots.js';
import type { CropDefinition } from './types.js';

/** Every crop of the catalogue, keyed by its identifier. */
export const CROPS: Readonly<Record<CropId, CropDefinition>> = {
  MAIZ,
  WHEAT,
  CEBADA,
  AVENA,
  CENTENO,
  SORGO,
  TRITICALE,
  MIJO,
  QUINOA,
  AMARANTO,
  FRIJOL,
  GARBANZO,
  LENTEJA,
  CHICHARO,
  HABA,
  SOYA,
  CACAHUATE,
  CANOLA,
  GIRASOL,
  AJONJOLI,
  LINAZA,
  MOSTAZA,
  ALGODON,
  TABACO,
  PAPA,
  JICAMA,
  BETABEL,
  ZANAHORIA,
  RABANO,
  CHIRIVIA,
  CEBOLLA,
  AJO,
  LECHUGA,
  ESPINACA,
  ACELGA,
  COL,
  COLIFLOR,
  BROCOLI,
  PEPINO,
  CALABACITA,
  CALABAZA,
  MELON,
  SANDIA,
  BERENJENA,
  TOMATE,
  TOMATILLO,
  CHILE,
  PIMIENTO,
  EJOTE,
  CILANTRO,
  PEREJIL,
  ALBAHACA,
  MANZANILLA,
  CEMPASUCHIL,
  GIRASOL_ORNAMENTAL,
  CRISANTEMO,
  TULIPAN,
  DALIA,
  MAIZ_FORRAJERO,
  SORGO_FORRAJERO,
  AVENA_FORRAJERA,
  CENTENO_FORRAJERO,
};
