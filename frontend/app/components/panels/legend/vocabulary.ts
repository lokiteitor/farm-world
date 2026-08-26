// What every colour and every state of the canvas is called.
//
// Owner: W4-E. Read by the legend, the cell inspector, the field listing, the field
// inspector and the minimap.
//
// The art is abstract and generated in code (plan section 9.4), so the legend is not
// decoration but a requirement of playability (GDD sections 59 and 60): without it a
// brown cell and a slightly different brown cell are indistinguishable, and the eight
// states of the crop cycle are the whole agricultural loop of GDD section 76.
//
// Two rules hold this module together.
//
// The colours come from `game/textures/palette.ts` and never from a literal. That module
// is the single source plan section 9.4 asks for: the same numbers generate the Phaser
// textures, the pixel of the minimap and, through the generated block of
// `assets/tokens.css`, the CSS variables. Reading it directly rather than through the CSS
// variables is deliberate here: a swatch that reads `var(--fw-crop-growing, #5f9a3f)`
// carries a hand written fallback, which is a second palette waiting to drift, whereas
// `toCssHex(PALETTE.crop.GROWING.mark)` cannot disagree with the canvas by construction.
//
// The names are the interface language, Spanish, and every set is a total record over the
// domain enum, so a value added to the vocabulary of `shared/domain/enums.ts` stops the
// compilation here instead of rendering as a raw identifier.

import {
  GRID_LINE_ALPHA,
  OWNERSHIP_WASH_ALPHA,
  PALETTE,
  toCssHex,
  toCssHexAlpha,
} from '~/game/textures/palette';
import {
  type BuildingType,
  CellOwnership,
  CROPS,
  CROP_IDS,
  CropCycleState,
  type CropFamily,
  type CropId,
  LandUse,
  type Season,
  type SoilCondition,
  type StorageResource,
  type TaskOperation,
  TerrainType,
  TreeGrowthStage,
} from '~/shared/index';

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Generated terrain (GDD section 8). */
export const TERRAIN_LABELS: Readonly<Record<TerrainType, string>> = {
  GRASS: 'Pradera',
  FOREST: 'Bosque',
  MOUNTAIN: 'Montana',
  WATER: 'Agua',
};

/** Whose the cell is, from the point of view of this player (GDD section 14). */
export const OWNERSHIP_LABELS: Readonly<Record<CellOwnership, string>> = {
  UNOWNED: 'Sin propietario',
  PLAYER: 'En propiedad',
  OTHER: 'De otro jugador',
};

/** What the cell is used for. The uses are exclusive (GDD section 15). */
export const LAND_USE_LABELS: Readonly<Record<LandUse, string>> = {
  NONE: 'Sin comprar',
  OWNED: 'Suelo libre',
  FIELD: 'Campo',
  FOREST_PLOT: 'Parcela forestal',
  BUILDING: 'Edificio',
  ROAD: 'Camino',
};

/** The eight states of the crop cycle, in cycle order (GDD sections 41 y 76). */
export const CROP_STATE_LABELS: Readonly<Record<CropCycleState, string>> = {
  VIRGIN: 'Barbecho',
  PLOWED: 'Arado',
  CULTIVATED: 'Labrado',
  SEEDED: 'Sembrado',
  GERMINATING: 'Germinando',
  GROWING: 'Creciendo',
  READY_TO_HARVEST: 'Listo para cosechar',
  HARVESTED: 'Cosechado',
};

/** One line per state, for the legend and for the inspector (GDD section 76). */
export const CROP_STATE_DETAILS: Readonly<Record<CropCycleState, string>> = {
  VIRGIN: 'Suelo sin trabajar. La fertilidad se recupera mientras permanece asi.',
  PLOWED: 'Arado. Admite sembrar directamente o labrar antes.',
  CULTIVATED: 'Labrado. Restablece las malezas a cero antes de sembrar.',
  SEEDED: 'Sembrado. La primera fase temporizada del ciclo.',
  GERMINATING: 'Germinando. Transicion automatica por tiempo de juego.',
  GROWING: 'Creciendo. El progreso viaja como tinte sobre la celda.',
  READY_TO_HARVEST: 'Listo para cosechar. Las malezas siguen creciendo.',
  HARVESTED: 'Cosechado. Vuelve a barbecho segun el cultivo.',
};

/**
 * Condition of the soil (GDD section 81). `COMPACTED` is a reserved value the MVP never
 * produces, and it is named anyway so that the day it does the interface is not the thing
 * that has to be invented.
 */
export const SOIL_CONDITION_LABELS: Readonly<Record<SoilCondition, string>> = {
  UNTOUCHED: 'Sin trabajar',
  PLOWED: 'Arado',
  CULTIVATED: 'Labrado',
  COMPACTED: 'Compactado',
};

/** The four life stages of a tree, derived from its age (GDD section 131). */
export const TREE_STAGE_LABELS: Readonly<Record<TreeGrowthStage, string>> = {
  SAPLING: 'Planton',
  YOUNG: 'Joven',
  MATURE: 'Maduro',
  OLD_GROWTH: 'Viejo',
};

/** Operations a task can carry out (GDD sections 90, 111 y 137). */
export const OPERATION_LABELS: Readonly<Record<TaskOperation, string>> = {
  PLOW: 'Arar',
  CULTIVATE: 'Labrar',
  SEED: 'Sembrar',
  HARVEST: 'Cosechar',
  FELL: 'Talar',
  REPLANT: 'Replantar',
  CLEAR_LAND: 'Desmontar',
};

/**
 * Crops of the catalogue (GDD section 82).
 *
 * Derived from the catalogue and no longer written out here. With sixty two crops a hand
 * written table is a second list of names waiting to disagree with the first, and the
 * compiler only catches the missing ones, never the wrong ones. `nameEs` lives in
 * `shared/config/crops/` for the same reason `VALIDATION_MESSAGES` lives in the domain:
 * the name of a thing belongs with the thing.
 */
export const CROP_LABELS: Readonly<Record<CropId, string>> = Object.fromEntries(
  CROP_IDS.map((id) => [id, CROPS[id].nameEs]),
) as Record<CropId, string>;

/** Families of the catalogue, which is how the interface groups sixty two crops. */
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

/** The four seasons of the world clock. */
export const SEASON_LABELS: Readonly<Record<Season, string>> = {
  SPRING: 'Primavera',
  SUMMER: 'Verano',
  AUTUMN: 'Otonio',
  WINTER: 'Invierno',
};

/** Storage categories: what a store holds, and therefore what has to be built. */
export const STORAGE_CATEGORY_LABELS: Readonly<Record<StorageResource, string>> = {
  GRAIN_LITERS: 'Grano',
  FORAGE_LITERS: 'Forraje',
  PRODUCE_LITERS: 'Hortaliza',
  INDUSTRIAL_LITERS: 'Industrial',
  WOOD_M3: 'Madera',
};

/** Buildings of the catalogue (GDD sections 116 y 136). */
export const BUILDING_LABELS: Readonly<Record<BuildingType, string>> = {
  GARAGE: 'Garaje',
  SILO: 'Silo',
  WORKER_HOME: 'Vivienda',
  WORKSHOP: 'Taller',
  WOOD_STORAGE: 'Almacen de madera',
  HAY_BARN: 'Henil',
  COLD_STORE: 'Camara fria',
  WAREHOUSE: 'Almacen',
};

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export function terrainColour(terrain: TerrainType): string {
  return toCssHex(PALETTE.terrain[terrain].base);
}

/**
 * Colour of the state mark and not of its soil. Two states share a soil colour on
 * purpose (`SEEDED` and `GERMINATING`), and it is the mark that names the state, which
 * is the same choice `paletteCssVariables` makes for the CSS block.
 */
export function cropStateColour(state: CropCycleState): string {
  return toCssHex(PALETTE.crop[state].mark);
}

export function treeStageColour(stage: TreeGrowthStage): string {
  return toCssHex(PALETTE.tree[stage].canopy);
}

/** Colour of a land use, or the void colour for `NONE`, which paints nothing. */
export function landUseColour(use: LandUse): string {
  return use === LandUse.NONE ? toCssHex(PALETTE.ui.canvasVoid) : toCssHex(PALETTE.use[use]);
}

export function ownershipColour(ownership: CellOwnership): string {
  switch (ownership) {
    case CellOwnership.PLAYER:
      return toCssHex(PALETTE.use.OWNED);
    case CellOwnership.OTHER:
      return toCssHex(PALETTE.ownedForeign);
    case CellOwnership.UNOWNED:
      return toCssHex(PALETTE.ui.canvasVoid);
  }
}

// ---------------------------------------------------------------------------
// The legend itself
// ---------------------------------------------------------------------------

export interface LegendEntry {
  readonly key: string;
  readonly label: string;
  /** A CSS colour, straight from the palette. */
  readonly colour: string;
  readonly detail: string;
}

export interface LegendGroup {
  readonly id: string;
  readonly title: string;
  /** Sections of the GDD the group answers to, shown so the reviewer can cross them. */
  readonly gddSections: readonly number[];
  readonly entries: readonly LegendEntry[];
}

/**
 * The whole key of the canvas, in the order the eye needs it: the ground first, then who
 * owns it, then what it is being used for, then the state of the crop, then the trees,
 * and last the marks the tool itself draws.
 */
export const LEGEND_GROUPS: readonly LegendGroup[] = [
  {
    id: 'terrain',
    title: 'Terreno',
    gddSections: [7, 8],
    entries: Object.values(TerrainType).map((terrain) => ({
      key: terrain,
      label: TERRAIN_LABELS[terrain],
      colour: terrainColour(terrain),
      detail:
        terrain === TerrainType.GRASS
          ? 'Comprable, cultivable y edificable.'
          : terrain === TerrainType.FOREST
            ? 'Comprable. Exige desmonte antes de cultivar.'
            : 'No comprable.',
    })),
  },
  {
    id: 'ownership',
    title: 'Propiedad',
    gddSections: [13, 14],
    entries: [
      {
        key: 'PLAYER',
        label: OWNERSHIP_LABELS.PLAYER,
        colour: ownershipColour(CellOwnership.PLAYER),
        detail: 'Tinte amarillo sobre el terreno, mas el contorno de la parcela.',
      },
      {
        key: 'OTHER',
        label: OWNERSHIP_LABELS.OTHER,
        colour: ownershipColour(CellOwnership.OTHER),
        detail: 'Visible y no comprable: el MVP no admite comercio de suelo.',
      },
      {
        key: 'UNOWNED',
        label: OWNERSHIP_LABELS.UNOWNED,
        colour: toCssHexAlpha(PALETTE.use.OWNED, OWNERSHIP_WASH_ALPHA),
        detail: 'Sin tinte: el terreno se ve tal cual lo genera la semilla.',
      },
    ],
  },
  {
    id: 'use',
    title: 'Uso del suelo',
    gddSections: [15, 16, 24, 129],
    entries: [LandUse.FIELD, LandUse.FOREST_PLOT, LandUse.BUILDING, LandUse.OWNED].map((use) => ({
      key: use,
      label: LAND_USE_LABELS[use],
      colour: landUseColour(use),
      detail:
        use === LandUse.OWNED
          ? 'Comprado y sin uso asignado. Es lo unico sobre lo que se puede crear algo.'
          : 'Los usos son excluyentes: una celda solo puede tener uno.',
    })),
  },
  {
    id: 'crop',
    title: 'Ciclo de cultivo',
    gddSections: [41, 76, 80],
    entries: Object.values(CropCycleState).map((state) => ({
      key: state,
      label: CROP_STATE_LABELS[state],
      colour: cropStateColour(state),
      detail: CROP_STATE_DETAILS[state],
    })),
  },
  {
    id: 'tree',
    title: 'Fases del arbol',
    gddSections: [131, 133],
    entries: Object.values(TreeGrowthStage).map((stage) => ({
      key: stage,
      label: TREE_STAGE_LABELS[stage],
      colour: treeStageColour(stage),
      detail: 'La fase se deriva de la edad y nunca se almacena.',
    })),
  },
  {
    id: 'selection',
    title: 'Seleccion y contornos',
    gddSections: [17, 19, 59],
    entries: [
      {
        key: 'SELECT_VALID',
        label: 'Celda valida',
        colour: toCssHex(PALETTE.ui.cursorValid),
        detail: 'Cumple la regla compartida de la operacion en curso.',
      },
      {
        key: 'SELECT_INVALID',
        label: 'Celda no valida',
        colour: toCssHex(PALETTE.ui.cursorInvalid),
        detail: 'El motivo aparece agregado en el panel de la operacion.',
      },
      {
        key: 'SELECT_NEUTRAL',
        label: 'Celda sin resolver',
        colour: toCssHex(PALETTE.ui.cursorNeutral),
        detail: 'Su chunk no ha llegado todavia: no es invalida, es desconocida.',
      },
      {
        key: 'SELECT_PENDING',
        label: 'Pendiente de confirmar',
        colour: toCssHex(PALETTE.ui.pending),
        detail: 'Enviada al servidor y sin respuesta. El cliente no adelanta el cambio.',
      },
      {
        key: 'OUTLINE_OWNED',
        label: 'Contorno de propiedad',
        colour: toCssHex(PALETTE.ui.outlineProperty),
        detail: 'Limite del conjunto de celdas en propiedad.',
      },
      {
        key: 'OUTLINE_FIELD',
        label: 'Contorno de campo',
        colour: toCssHex(PALETTE.ui.outlineField),
        detail: 'Un contorno por campo, de modo que dos campos vecinos se distinguen.',
      },
      {
        key: 'OUTLINE_FARM',
        label: 'Contorno de granja',
        colour: toCssHex(PALETTE.ui.outlineFarm),
        detail: 'Huella de los edificios de la granja.',
      },
      {
        key: 'OUTLINE_FOREST',
        label: 'Contorno de parcela forestal',
        colour: toCssHex(PALETTE.ui.outlineForestPlot),
        detail: 'Limite de la parcela, no de cada arbol.',
      },
      {
        key: 'GRID',
        label: 'Rejilla',
        colour: toCssHexAlpha(PALETTE.ui.grid, GRID_LINE_ALPHA),
        detail: 'Solo con detalle cercano: por debajo, una linea cada cuatro pixeles es ruido.',
      },
    ],
  },
];
