// Validation of a selection of cells, shared by the server and the client.
//
// Owner: workflow W2 (pure rules).
//
// This is the module plan section 8 has in mind when it says that the green highlight
// of a selection and the 400 of the server cannot be allowed to diverge: the drag
// tool of the client calls these functions on every cell boundary crossing, and the
// endpoint calls the same ones before mutating anything. One rule, two callers.
//
// Shape of the answer. A per cell predicate returns the `ValidationCode` of the first
// rule the cell fails, or null. `validateSelection` aggregates those codes into one
// issue per code, with how many cells are affected and the first of them, which is
// what lets the interface show a short actionable list and jump the camera to the
// first conflict instead of listing two thousand identical errors.

import { BUILDING_CATALOGUE, type BuildingDefinition } from '../config/buildings.js';
import {
  ARABLE_TERRAINS,
  BUILDABLE_TERRAINS,
  FORESTABLE_TERRAINS,
  PURCHASABLE_TERRAINS,
} from '../config/transitions.js';
import { MAX_SELECTION_CELLS } from '../config/world.js';
import { type CellCoord } from '../domain/entities.js';
import {
  LandUse,
  ValidationCode,
  VALIDATION_MESSAGES,
  type BuildingType,
  type TerrainType,
} from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { isAdjacentTo, isContiguous } from './geometry.js';
import {
  DEFAULT_LAND_PRICE_CONFIG,
  landPurchasePrice,
  type LandPriceBreakdown,
  type LandPriceConfig,
} from './pricing.js';

/** Who owns a cell, from the point of view of the player making the selection. */
export const CellOwnership = {
  UNOWNED: 'UNOWNED',
  PLAYER: 'PLAYER',
  OTHER: 'OTHER',
} as const;
export type CellOwnership = (typeof CellOwnership)[keyof typeof CellOwnership];

/**
 * The part of a cell the selection rules need. It is deliberately not the `Cell`
 * entity: the client holds a decoded chunk and not a row, and the effective terrain
 * (the override of a cleared forest, when there is one) is already resolved here.
 */
export interface SelectionCell extends CellCoord {
  readonly terrain: TerrainType;
  readonly ownership: CellOwnership;
  readonly landUse: LandUse;
  readonly hasStandingTree: boolean;
}

/** What the selection is for. Each purpose has its own per cell rule. */
export const SelectionPurpose = {
  PURCHASE: 'PURCHASE',
  FIELD: 'FIELD',
  FIELD_EXTEND: 'FIELD_EXTEND',
  BUILDING: 'BUILDING',
  FOREST_PLOT: 'FOREST_PLOT',
  CLEAR_LAND: 'CLEAR_LAND',
} as const;
export type SelectionPurpose = (typeof SelectionPurpose)[keyof typeof SelectionPurpose];

/** Terrain lists and prices, injected so the tests can fix them. */
export interface SelectionConfig {
  readonly purchasableTerrains: readonly TerrainType[];
  readonly arableTerrains: readonly TerrainType[];
  readonly buildableTerrains: readonly TerrainType[];
  readonly forestableTerrains: readonly TerrainType[];
  readonly landPrice: LandPriceConfig;
  readonly maxSelectionCells: number;
}

export const DEFAULT_SELECTION_CONFIG: SelectionConfig = {
  purchasableTerrains: PURCHASABLE_TERRAINS,
  arableTerrains: ARABLE_TERRAINS,
  buildableTerrains: BUILDABLE_TERRAINS,
  forestableTerrains: FORESTABLE_TERRAINS,
  landPrice: DEFAULT_LAND_PRICE_CONFIG,
  maxSelectionCells: MAX_SELECTION_CELLS,
};

// ---------------------------------------------------------------------------
// Per cell rules
// ---------------------------------------------------------------------------

/**
 * Whether a cell can be bought (GDD sections 8, 13 and 14). Mountain and water are
 * not purchasable, and a cell that already has an owner is not on the market: the MVP
 * has no land trading between players.
 */
export function canPurchase(
  cell: SelectionCell,
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
): ValidationCode | null {
  if (!config.purchasableTerrains.includes(cell.terrain)) {
    return ValidationCode.TERRAIN_NOT_PURCHASABLE;
  }
  if (cell.ownership !== CellOwnership.UNOWNED) {
    return ValidationCode.CELL_ALREADY_OWNED;
  }
  return null;
}

/**
 * Whether a cell can become part of a field (GDD section 17). Forest is not directly
 * arable: it has to be cleared first, which is the `CLEAR_LAND` operation of GDD
 * section 10.
 */
export function canBeFieldCell(
  cell: SelectionCell,
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
): ValidationCode | null {
  if (cell.ownership !== CellOwnership.PLAYER) {
    return ValidationCode.CELL_NOT_OWNED;
  }
  if (!config.arableTerrains.includes(cell.terrain)) {
    return ValidationCode.TERRAIN_NOT_ARABLE;
  }
  if (cell.hasStandingTree) {
    return ValidationCode.CELL_HAS_STANDING_TREE;
  }
  if (cell.landUse !== LandUse.OWNED) {
    return ValidationCode.CELL_IN_USE;
  }
  return null;
}

/**
 * Whether a building may sit on a cell (GDD sections 8, 15 and 24). A cell taken by
 * infrastructure or by a field cannot be built on: GDD section 15 makes the uses
 * exclusive.
 */
export function canBuildOn(
  cell: SelectionCell,
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
): ValidationCode | null {
  if (cell.ownership !== CellOwnership.PLAYER) {
    return ValidationCode.CELL_NOT_OWNED;
  }
  if (!config.buildableTerrains.includes(cell.terrain)) {
    return ValidationCode.TERRAIN_NOT_BUILDABLE;
  }
  if (cell.hasStandingTree) {
    return ValidationCode.CELL_HAS_STANDING_TREE;
  }
  if (cell.landUse !== LandUse.OWNED) {
    return ValidationCode.CELL_IN_USE;
  }
  return null;
}

/** Whether a cell can become part of a forest plot (GDD sections 8, 10 and 129). */
export function canBeForestPlotCell(
  cell: SelectionCell,
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
): ValidationCode | null {
  if (cell.ownership !== CellOwnership.PLAYER) {
    return ValidationCode.CELL_NOT_OWNED;
  }
  if (!config.forestableTerrains.includes(cell.terrain)) {
    return ValidationCode.TERRAIN_NOT_FORESTABLE;
  }
  if (cell.landUse !== LandUse.OWNED) {
    return ValidationCode.CELL_IN_USE;
  }
  return null;
}

/**
 * Whether a cell can be cleared into arable land (GDD sections 10 and 137). The trees
 * have to be felled first: clearing turns stump ground into a field, it does not
 * harvest the wood.
 */
export function canClearCell(
  cell: SelectionCell,
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
): ValidationCode | null {
  if (cell.ownership !== CellOwnership.PLAYER) {
    return ValidationCode.CELL_NOT_OWNED;
  }
  if (!config.forestableTerrains.includes(cell.terrain)) {
    return ValidationCode.TERRAIN_NOT_FORESTABLE;
  }
  if (cell.hasStandingTree) {
    return ValidationCode.CELL_HAS_STANDING_TREE;
  }
  if (cell.landUse !== LandUse.OWNED && cell.landUse !== LandUse.FOREST_PLOT) {
    return ValidationCode.CELL_IN_USE;
  }
  return null;
}

/**
 * Price of the purchasable part of a selection (GDD section 115). Cells that already
 * belong to the player cost nothing, and cells whose terrain has no price are
 * counted apart so that the interface can still show a budget for a drag that is
 * partly invalid.
 */
export function priceOf(
  cells: readonly SelectionCell[],
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
): LandPriceBreakdown {
  const terrains = cells
    .filter((cell) => cell.ownership === CellOwnership.UNOWNED)
    .map((cell) => cell.terrain);
  return landPurchasePrice(terrains, config.landPrice);
}

// ---------------------------------------------------------------------------
// Aggregate validation
// ---------------------------------------------------------------------------

interface SelectionPurposeRule {
  readonly cellRule: (cell: SelectionCell, config: SelectionConfig) => ValidationCode | null;
  readonly requiresContiguity: boolean;
  readonly requiresAdjacency: boolean;
  readonly priced: boolean;
}

/**
 * Per purpose rules. Contiguity is required where the GDD requires a single surface
 * (a field in section 17, a farm footprint in section 24, a plot in section 129) and
 * not for a purchase, which GDD section 14 never constrains: buying scattered cells
 * is a legitimate, if impractical, strategy.
 */
export const SELECTION_PURPOSE_RULES: Readonly<Record<SelectionPurpose, SelectionPurposeRule>> = {
  PURCHASE: {
    cellRule: canPurchase,
    requiresContiguity: false,
    requiresAdjacency: false,
    priced: true,
  },
  FIELD: {
    cellRule: canBeFieldCell,
    requiresContiguity: true,
    requiresAdjacency: false,
    priced: false,
  },
  FIELD_EXTEND: {
    cellRule: canBeFieldCell,
    requiresContiguity: true,
    requiresAdjacency: true,
    priced: false,
  },
  BUILDING: {
    cellRule: canBuildOn,
    requiresContiguity: true,
    requiresAdjacency: false,
    priced: false,
  },
  FOREST_PLOT: {
    cellRule: canBeForestPlotCell,
    requiresContiguity: true,
    requiresAdjacency: false,
    priced: false,
  },
  CLEAR_LAND: {
    cellRule: canClearCell,
    requiresContiguity: false,
    requiresAdjacency: false,
    priced: false,
  },
};

/** One reason a selection is invalid, aggregated over the cells that share it. */
export interface SelectionIssue {
  readonly code: ValidationCode;
  /** The message of the shared table, so the client does not keep its own copy. */
  readonly message: string;
  /** Cells affected. Equal to the size of the selection for a whole selection rule. */
  readonly cellCount: number;
  /** First affected cell in the order the selection was sent, or null. */
  readonly firstCell: CellCoord | null;
}

export interface SelectionValidation {
  readonly ok: boolean;
  readonly cellCount: number;
  /** Cells that pass their per cell rule. */
  readonly validCellCount: number;
  readonly issues: readonly SelectionIssue[];
  /** Price of the purchasable part, zero for purposes that buy nothing. */
  readonly price: Money;
}

export interface SelectionValidationInput {
  readonly purpose: SelectionPurpose;
  readonly cells: readonly SelectionCell[];
  /**
   * Cells of the surface the selection must touch. Required by `FIELD_EXTEND`, where
   * GDD section 20 asks for adjacent land.
   */
  readonly adjacentTo?: readonly CellCoord[] | undefined;
}

/**
 * Every reason a selection is refused, aggregated by code.
 *
 * The whole selection rules come first, because "the selection is not contiguous"
 * explains the situation better than two hundred per cell reasons, and the per cell
 * ones follow in the order they were first met.
 */
export function validateSelection(
  input: SelectionValidationInput,
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
): SelectionValidation {
  const rule = SELECTION_PURPOSE_RULES[input.purpose];
  const cellCount = input.cells.length;
  const issues: SelectionIssue[] = [];
  const issue = (code: ValidationCode, count: number, firstCell: CellCoord | null): void => {
    issues.push({ code, message: VALIDATION_MESSAGES[code], cellCount: count, firstCell });
  };

  if (cellCount === 0) {
    issue(ValidationCode.SELECTION_EMPTY, 0, null);
    return { ok: false, cellCount, validCellCount: 0, issues, price: Money.ZERO };
  }
  if (cellCount > config.maxSelectionCells) {
    issue(ValidationCode.SELECTION_TOO_LARGE, cellCount, null);
  }
  if (rule.requiresContiguity && !isContiguous(input.cells, config.maxSelectionCells)) {
    issue(ValidationCode.SELECTION_NOT_CONTIGUOUS, cellCount, null);
  }
  if (rule.requiresAdjacency) {
    const target = input.adjacentTo ?? [];
    if (!isAdjacentTo(input.cells, target)) {
      issue(ValidationCode.SELECTION_NOT_ADJACENT, cellCount, null);
    }
  }

  const perCode = new Map<ValidationCode, { count: number; firstCell: CellCoord }>();
  let validCellCount = 0;
  for (const cell of input.cells) {
    const code = rule.cellRule(cell, config);
    if (code === null) {
      validCellCount += 1;
      continue;
    }
    const existing = perCode.get(code);
    if (existing === undefined) {
      perCode.set(code, { count: 1, firstCell: { cellX: cell.cellX, cellY: cell.cellY } });
    } else {
      existing.count += 1;
    }
  }
  for (const [code, aggregate] of perCode) {
    issue(code, aggregate.count, aggregate.firstCell);
  }

  return {
    ok: issues.length === 0,
    cellCount,
    validCellCount,
    issues,
    price: rule.priced ? priceOf(input.cells, config).total : Money.ZERO,
  };
}

/**
 * Whether a rectangular footprint of a building fits on a set of cells, and what it
 * costs. The footprint is a rectangle of the catalogue, so contiguity is implied and
 * the only remaining questions are the per cell rules and the exact cell count.
 */
export function validateBuildingFootprint(
  input: {
    readonly type: BuildingType;
    readonly cells: readonly SelectionCell[];
  },
  options: {
    readonly catalogue?: Readonly<Record<BuildingType, BuildingDefinition>>;
    readonly config?: SelectionConfig;
  } = {},
): SelectionValidation {
  const definition = (options.catalogue ?? BUILDING_CATALOGUE)[input.type];
  const config = options.config ?? DEFAULT_SELECTION_CONFIG;
  const base = validateSelection(
    { purpose: SelectionPurpose.BUILDING, cells: input.cells },
    config,
  );
  if (input.cells.length === definition.footprintCells) {
    return base;
  }
  // A footprint of the wrong size is a malformed request rather than a cell level
  // problem, so it is reported as the generic schema failure with the whole
  // selection as its extent.
  return {
    ...base,
    ok: false,
    issues: [
      {
        code: ValidationCode.VALIDATION_FAILED,
        message: VALIDATION_MESSAGES[ValidationCode.VALIDATION_FAILED],
        cellCount: input.cells.length,
        firstCell: null,
      },
      ...base.issues,
    ],
  };
}
