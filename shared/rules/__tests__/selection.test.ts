import { describe, expect, it } from 'vitest';
import { MAX_SELECTION_CELLS } from '../../config/world.js';
import {
  LandUse,
  ValidationCode,
  VALIDATION_MESSAGES,
  type TerrainType,
} from '../../domain/enums.js';
import { Money } from '../../domain/money.js';
import { bp } from '../../domain/units.js';
import {
  CellOwnership,
  SelectionPurpose,
  canBeFieldCell,
  canBeForestPlotCell,
  canBuildOn,
  canClearCell,
  canPurchase,
  priceOf,
  validateBuildingFootprint,
  validateSelection,
  type SelectionCell,
} from '../selection.js';

// The rules the drag tool of the client and the endpoint of the server share. Every
// assertion here is simultaneously a statement about the green highlight and about the
// 400 the server returns, which is the point of putting them in shared/.

function cell(overrides: Partial<SelectionCell> = {}): SelectionCell {
  return {
    cellX: 0,
    cellY: 0,
    terrain: 'GRASS',
    ownership: CellOwnership.UNOWNED,
    landUse: LandUse.NONE,
    hasStandingTree: false,
    ...overrides,
  };
}

function area(
  width: number,
  height: number,
  overrides: Partial<SelectionCell> = {},
): SelectionCell[] {
  const cells: SelectionCell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push(cell({ cellX: x, cellY: y, ...overrides }));
    }
  }
  return cells;
}

const owned: Partial<SelectionCell> = {
  ownership: CellOwnership.PLAYER,
  landUse: LandUse.OWNED,
};

describe('canPurchase (GDD sections 8, 13 and 14)', () => {
  it('accepts unowned grass and forest', () => {
    expect(canPurchase(cell({ terrain: 'GRASS' }))).toBeNull();
    expect(canPurchase(cell({ terrain: 'FOREST' }))).toBeNull();
  });

  it('refuses mountain and water', () => {
    expect(canPurchase(cell({ terrain: 'MOUNTAIN' }))).toBe(ValidationCode.TERRAIN_NOT_PURCHASABLE);
    expect(canPurchase(cell({ terrain: 'WATER' }))).toBe(ValidationCode.TERRAIN_NOT_PURCHASABLE);
  });

  it('refuses a cell that already has an owner, whoever it is', () => {
    expect(canPurchase(cell({ ownership: CellOwnership.PLAYER }))).toBe(
      ValidationCode.CELL_ALREADY_OWNED,
    );
    expect(canPurchase(cell({ ownership: CellOwnership.OTHER }))).toBe(
      ValidationCode.CELL_ALREADY_OWNED,
    );
  });
});

describe('canBeFieldCell (GDD section 17)', () => {
  it('accepts owned grass with no other use', () => {
    expect(canBeFieldCell(cell(owned))).toBeNull();
  });

  it('refuses land the player does not own', () => {
    expect(canBeFieldCell(cell({ landUse: LandUse.OWNED }))).toBe(ValidationCode.CELL_NOT_OWNED);
    expect(canBeFieldCell(cell({ ...owned, ownership: CellOwnership.OTHER }))).toBe(
      ValidationCode.CELL_NOT_OWNED,
    );
  });

  it('refuses terrain that is not arable, including forest before it is cleared', () => {
    for (const terrain of ['FOREST', 'MOUNTAIN', 'WATER'] as const) {
      expect(canBeFieldCell(cell({ ...owned, terrain }))).toBe(ValidationCode.TERRAIN_NOT_ARABLE);
    }
  });

  it('refuses a cell already taken by another use (GDD section 15)', () => {
    for (const landUse of [LandUse.FIELD, LandUse.BUILDING, LandUse.FOREST_PLOT, LandUse.ROAD]) {
      expect(canBeFieldCell(cell({ ...owned, landUse }))).toBe(ValidationCode.CELL_IN_USE);
    }
  });

  it('refuses a cell with a standing tree', () => {
    expect(canBeFieldCell(cell({ ...owned, hasStandingTree: true }))).toBe(
      ValidationCode.CELL_HAS_STANDING_TREE,
    );
  });
});

describe('canBuildOn and the forestry rules', () => {
  it('accepts owned grass for a building and refuses forest and water', () => {
    expect(canBuildOn(cell(owned))).toBeNull();
    expect(canBuildOn(cell({ ...owned, terrain: 'FOREST' }))).toBe(
      ValidationCode.TERRAIN_NOT_BUILDABLE,
    );
    expect(canBuildOn(cell({ ...owned, terrain: 'WATER' }))).toBe(
      ValidationCode.TERRAIN_NOT_BUILDABLE,
    );
  });

  it('accepts owned forest for a plot and refuses grass', () => {
    expect(canBeForestPlotCell(cell({ ...owned, terrain: 'FOREST' }))).toBeNull();
    expect(canBeForestPlotCell(cell(owned))).toBe(ValidationCode.TERRAIN_NOT_FORESTABLE);
  });

  it('accepts clearing a felled forest cell and refuses one with a tree still standing', () => {
    expect(canClearCell(cell({ ...owned, terrain: 'FOREST' }))).toBeNull();
    expect(
      canClearCell(cell({ ...owned, terrain: 'FOREST', landUse: LandUse.FOREST_PLOT })),
    ).toBeNull();
    expect(canClearCell(cell({ ...owned, terrain: 'FOREST', hasStandingTree: true }))).toBe(
      ValidationCode.CELL_HAS_STANDING_TREE,
    );
  });
});

describe('priceOf (GDD section 115)', () => {
  it('prices only the cells that are still unowned', () => {
    const selection = [
      cell({ cellX: 0, terrain: 'GRASS' }),
      cell({ cellX: 1, terrain: 'GRASS', ...owned }),
      cell({ cellX: 2, terrain: 'FOREST' }),
    ];
    const breakdown = priceOf(selection);
    expect(breakdown.total).toBe(Money.fromUnits(190));
    expect(breakdown.pricedCells).toBe(2);
  });
});

describe('validateSelection', () => {
  it('reports an empty selection and nothing else', () => {
    const result = validateSelection({ purpose: SelectionPurpose.FIELD, cells: [] });
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe(ValidationCode.SELECTION_EMPTY);
    expect(result.price).toBe(Money.ZERO);
  });

  it('accepts a valid field and reports no price for it', () => {
    const result = validateSelection({
      purpose: SelectionPurpose.FIELD,
      cells: area(10, 25, owned),
    });
    expect(result.ok).toBe(true);
    expect(result.cellCount).toBe(250);
    expect(result.validCellCount).toBe(250);
    expect(result.price).toBe(Money.ZERO);
  });

  it('accepts a purchase and reports the price of GDD section 117', () => {
    const result = validateSelection({
      purpose: SelectionPurpose.PURCHASE,
      cells: area(33, 10),
    });
    expect(result.ok).toBe(true);
    expect(result.price).toBe(Money.fromUnits(39_600));
  });

  it('aggregates one issue per code, with the count and the first cell', () => {
    const cells = [
      ...area(3, 1, owned),
      cell({ cellX: 5, cellY: 0, terrain: 'WATER', ...owned }),
      cell({ cellX: 6, cellY: 0, terrain: 'WATER', ...owned }),
      cell({ cellX: 7, cellY: 0, ownership: CellOwnership.OTHER, landUse: LandUse.OWNED }),
    ];
    const result = validateSelection({ purpose: SelectionPurpose.FIELD, cells });
    expect(result.ok).toBe(false);
    expect(result.validCellCount).toBe(3);
    const codes = result.issues.map((issue) => issue.code);
    // The whole selection rule comes first, then the per cell ones in the order met.
    expect(codes).toEqual([
      ValidationCode.SELECTION_NOT_CONTIGUOUS,
      ValidationCode.TERRAIN_NOT_ARABLE,
      ValidationCode.CELL_NOT_OWNED,
    ]);
    const notArable = result.issues.find(
      (issue) => issue.code === ValidationCode.TERRAIN_NOT_ARABLE,
    );
    expect(notArable?.cellCount).toBe(2);
    expect(notArable?.firstCell).toEqual({ cellX: 5, cellY: 0 });
    expect(notArable?.message).toBe(VALIDATION_MESSAGES[ValidationCode.TERRAIN_NOT_ARABLE]);
  });

  it('reports the shared ceiling of 2 000 cells', () => {
    const result = validateSelection({
      purpose: SelectionPurpose.PURCHASE,
      cells: area(50, 41),
    });
    expect(result.cellCount).toBeGreaterThan(MAX_SELECTION_CELLS);
    expect(result.issues.map((issue) => issue.code)).toContain(ValidationCode.SELECTION_TOO_LARGE);
  });

  it('does not require contiguity for a purchase, which the GDD never constrains', () => {
    const scattered = [cell({ cellX: 0, cellY: 0 }), cell({ cellX: 50, cellY: 50 })];
    expect(validateSelection({ purpose: SelectionPurpose.PURCHASE, cells: scattered }).ok).toBe(
      true,
    );
    expect(validateSelection({ purpose: SelectionPurpose.FIELD, cells: scattered }).ok).toBe(false);
  });

  it('requires adjacency for an extension (GDD section 20)', () => {
    const extension = area(2, 4, owned).map((source) => ({ ...source, cellX: source.cellX + 4 }));
    const field = [{ cellX: 3, cellY: 0 }];
    expect(
      validateSelection({
        purpose: SelectionPurpose.FIELD_EXTEND,
        cells: extension,
        adjacentTo: field,
      }).ok,
    ).toBe(true);
    expect(
      validateSelection({
        purpose: SelectionPurpose.FIELD_EXTEND,
        cells: extension,
        adjacentTo: [{ cellX: 100, cellY: 100 }],
      }).issues.map((issue) => issue.code),
    ).toContain(ValidationCode.SELECTION_NOT_ADJACENT);
    // No target at all is not adjacency either.
    expect(validateSelection({ purpose: SelectionPurpose.FIELD_EXTEND, cells: extension }).ok).toBe(
      false,
    );
  });

  it('honours an injected configuration, so a test can widen what is arable', () => {
    const forest = area(2, 2, { ...owned, terrain: 'FOREST' });
    const permissive = validateSelection(
      { purpose: SelectionPurpose.FIELD, cells: forest },
      {
        purchasableTerrains: ['GRASS', 'FOREST'],
        arableTerrains: ['GRASS', 'FOREST'] as readonly TerrainType[],
        buildableTerrains: ['GRASS'],
        forestableTerrains: ['FOREST'],
        landPrice: {
          basePriceByTerrain: {
            GRASS: Money.fromUnits(120),
            FOREST: Money.fromUnits(70),
            MOUNTAIN: null,
            WATER: null,
          },
          locationMultiplierBp: bp(10_000),
          accessibilityMultiplierBp: bp(10_000),
        },
        maxSelectionCells: MAX_SELECTION_CELLS,
      },
    );
    expect(permissive.ok).toBe(true);
  });
});

describe('validateBuildingFootprint (GDD sections 24 and 116)', () => {
  it('accepts a footprint of exactly the catalogue size on owned grass', () => {
    const garage = area(6, 8, owned);
    expect(garage).toHaveLength(48);
    expect(validateBuildingFootprint({ type: 'GARAGE', cells: garage }).ok).toBe(true);
  });

  it('refuses a footprint of the wrong size as a malformed request', () => {
    const result = validateBuildingFootprint({ type: 'GARAGE', cells: area(6, 7, owned) });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe(ValidationCode.VALIDATION_FAILED);
  });

  it('still reports the per cell reasons under a footprint of the right size', () => {
    const cells = area(4, 4, { ...owned, landUse: LandUse.BUILDING });
    const result = validateBuildingFootprint({ type: 'SILO', cells });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(ValidationCode.CELL_IN_USE);
  });
});
