// Names the report prints, in Spanish.
//
// Owner: workflow W6-E (balance report).
//
// The report is prose in Spanish and the catalogue names its crops in Spanish too, so a
// crop is printed with its own `nameEs` and never with a table repeated here. What does
// live here is what the catalogue has no name for: the family, the season and the storage
// category are closed sets of the domain, and the client keeps its own labels for them
// under `frontend/`, which this tool must not import.

import { type CropFamily, type Season, type StorageResource } from '../../shared/domain/enums.js';

export const CROP_FAMILY_LABELS: Readonly<Record<CropFamily, string>> = {
  CEREAL: 'Cereales',
  LEGUME: 'Legumbres',
  OILSEED: 'Oleaginosas',
  INDUSTRIAL: 'Industriales',
  ROOT: 'Raices y bulbos',
  LEAFY: 'Hoja',
  FRUITING: 'Fruto',
  HERB: 'Hierbas',
  FLOWER: 'Flores',
  FORAGE: 'Forrajes',
};

export const SEASON_LABELS: Readonly<Record<Season, string>> = {
  SPRING: 'Primavera',
  SUMMER: 'Verano',
  AUTUMN: 'Otonio',
  WINTER: 'Invierno',
};

export const STORAGE_CATEGORY_LABELS: Readonly<Record<StorageResource, string>> = {
  GRAIN_LITERS: 'Grano',
  FORAGE_LITERS: 'Forraje',
  PRODUCE_LITERS: 'Hortaliza',
  INDUSTRIAL_LITERS: 'Industrial',
  WOOD_M3: 'Madera',
};
