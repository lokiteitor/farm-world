// Validity per mode, and the fact that seven of the nine modes are the shared rules.
//
// Owner: workflow W4-G. Each case states one rule of the GDD and checks the code the
// aggregate reports, because that code is what the server answers with and what the panel
// turns into a sentence: a test that only asserted `ok === false` would pass with the
// wrong reason.

import { describe, expect, it } from 'vitest';
import { resolveCells, type ToolCell } from '../cells';
import { SelectionToolMode } from '../modes';
import { cellRuleOf, firstConflictOf, validateToolSelection } from '../rules';
import { makeGrid, rectCells, STRANGER, VIEWER } from './fixtures';
import {
  BUILDING_CATALOGUE,
  DEFAULT_SELECTION_CONFIG,
  LandUse,
  Money,
  TerrainType,
  ValidationCode,
  cellKey,
  type CellCoordWire,
} from '~/shared/index';

function resolve(
  grid: ReturnType<typeof makeGrid>,
  cells: readonly CellCoordWire[],
): readonly ToolCell[] {
  return resolveCells(
    grid.reader,
    cells.map((cell) => cellKey(cell.cellX, cell.cellY)),
  ).cells;
}

function codes(validation: ReturnType<typeof validateToolSelection>): readonly ValidationCode[] {
  return validation.issues.map((issue) => issue.code);
}

describe('purchase (GDD sections 14 and 115)', () => {
  it('accepts unowned grass and prices it with the shared catalogue', () => {
    const grid = makeGrid();
    const cells = rectCells({ cellX: 0, cellY: 0 }, { cellX: 4, cellY: 4 });
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.PURCHASE },
      cells: resolve(grid, cells),
    });
    expect(validation.ok).toBe(true);
    expect(validation.cellCount).toBe(25);
    expect(Money.compare(validation.price, Money.ZERO)).toBe(1);
  });

  it('refuses a cell that already has an owner, and counts how many', () => {
    const grid = makeGrid();
    grid.fill({ cellX: 0, cellY: 0 }, { cellX: 1, cellY: 0 }, { ownerPlayerId: STRANGER });
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.PURCHASE },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 4, cellY: 0 })),
    });
    expect(codes(validation)).toContain(ValidationCode.CELL_ALREADY_OWNED);
    const issue = validation.issues.find(
      (candidate) => candidate.code === ValidationCode.CELL_ALREADY_OWNED,
    );
    expect(issue?.cellCount).toBe(2);
    expect(issue?.firstCell).toEqual({ cellX: 0, cellY: 0 });
  });

  it('refuses water and mountain, which GDD sections 11 and 12 make unpurchasable', () => {
    const grid = makeGrid({ terrain: TerrainType.WATER });
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.PURCHASE },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 1, cellY: 1 })),
    });
    expect(codes(validation)).toContain(ValidationCode.TERRAIN_NOT_PURCHASABLE);
  });

  it('does not require contiguity: scattered cells are a legitimate purchase', () => {
    const grid = makeGrid();
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.PURCHASE },
      cells: resolve(grid, [
        { cellX: 0, cellY: 0 },
        { cellX: 9, cellY: 9 },
      ]),
    });
    expect(validation.ok).toBe(true);
  });
});

describe('field creation (GDD sections 17 and 19)', () => {
  it('requires the cells to belong to the player', () => {
    const grid = makeGrid();
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.FIELD_CREATE },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 2, cellY: 2 })),
    });
    expect(codes(validation)).toContain(ValidationCode.CELL_NOT_OWNED);
  });

  it('refuses a cell already taken by another use (GDD section 15)', () => {
    const grid = makeGrid();
    grid.fill(
      { cellX: 0, cellY: 0 },
      { cellX: 2, cellY: 2 },
      { ownerPlayerId: VIEWER, landUse: LandUse.OWNED },
    );
    grid.set({ cellX: 1, cellY: 1 }, { landUse: LandUse.BUILDING, buildingId: 'building-1' });
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.FIELD_CREATE },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 2, cellY: 2 })),
    });
    expect(codes(validation)).toContain(ValidationCode.CELL_IN_USE);
  });

  it('refuses a standing tree, which GDD section 10 asks to be cleared first', () => {
    const grid = makeGrid();
    grid.fill(
      { cellX: 0, cellY: 0 },
      { cellX: 2, cellY: 0 },
      { ownerPlayerId: VIEWER, landUse: LandUse.OWNED },
    );
    grid.set({ cellX: 2, cellY: 0 }, { hasStandingTree: true });
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.FIELD_CREATE },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 2, cellY: 0 })),
    });
    expect(codes(validation)).toContain(ValidationCode.CELL_HAS_STANDING_TREE);
  });
});

describe('field extension (GDD section 20)', () => {
  it('requires the new cells to touch the field', () => {
    const grid = makeGrid();
    grid.fill(
      { cellX: 0, cellY: 0 },
      { cellX: 10, cellY: 10 },
      { ownerPlayerId: VIEWER, landUse: LandUse.OWNED },
    );
    const target = rectCells({ cellX: 0, cellY: 0 }, { cellX: 1, cellY: 1 });
    const away = resolve(grid, rectCells({ cellX: 5, cellY: 5 }, { cellX: 6, cellY: 6 }));
    const detached = validateToolSelection({
      intent: {
        mode: SelectionToolMode.FIELD_EXTEND,
        fieldId: 'field-1',
        targetCells: target,
      },
      cells: away,
    });
    expect(codes(detached)).toContain(ValidationCode.SELECTION_NOT_ADJACENT);

    const beside = resolve(grid, rectCells({ cellX: 2, cellY: 0 }, { cellX: 3, cellY: 1 }));
    const attached = validateToolSelection({
      intent: {
        mode: SelectionToolMode.FIELD_EXTEND,
        fieldId: 'field-1',
        targetCells: target,
      },
      cells: beside,
    });
    expect(attached.ok).toBe(true);
  });
});

describe('field split (GDD section 21)', () => {
  const grid = makeGrid();
  grid.fill(
    { cellX: 0, cellY: 0 },
    { cellX: 3, cellY: 3 },
    { ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'field-1' },
  );
  const fieldCells = rectCells({ cellX: 0, cellY: 0 }, { cellX: 3, cellY: 3 });

  it('accepts a half that leaves a contiguous remainder', () => {
    const validation = validateToolSelection({
      intent: {
        mode: SelectionToolMode.FIELD_SPLIT,
        fieldId: 'field-1',
        targetCells: fieldCells,
      },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 1, cellY: 3 })),
    });
    expect(validation.ok).toBe(true);
  });

  it('refuses a selection that takes the whole field', () => {
    const validation = validateToolSelection({
      intent: {
        mode: SelectionToolMode.FIELD_SPLIT,
        fieldId: 'field-1',
        targetCells: fieldCells,
      },
      cells: resolve(grid, fieldCells),
    });
    expect(codes(validation)).toContain(ValidationCode.FIELD_SPLIT_INCOMPLETE);
  });

  it('refuses a doughnut, whose remainder is not contiguous', () => {
    // Taking the four cells of the middle column but one leaves the field in two pieces.
    const moved = [
      { cellX: 1, cellY: 0 },
      { cellX: 1, cellY: 1 },
      { cellX: 1, cellY: 2 },
      { cellX: 1, cellY: 3 },
      { cellX: 2, cellY: 0 },
      { cellX: 2, cellY: 1 },
      { cellX: 2, cellY: 2 },
      { cellX: 2, cellY: 3 },
    ];
    const validation = validateToolSelection({
      intent: {
        mode: SelectionToolMode.FIELD_SPLIT,
        fieldId: 'field-1',
        targetCells: fieldCells,
      },
      cells: resolve(grid, moved),
    });
    expect(codes(validation)).toContain(ValidationCode.FIELD_SPLIT_INCOMPLETE);
  });

  it('refuses a cell that is not part of the field', () => {
    const validation = validateToolSelection({
      intent: {
        mode: SelectionToolMode.FIELD_SPLIT,
        fieldId: 'field-1',
        targetCells: fieldCells,
      },
      cells: resolve(grid, [
        { cellX: 0, cellY: 0 },
        { cellX: 20, cellY: 20 },
      ]),
    });
    expect(codes(validation)).toContain(ValidationCode.FIELD_SPLIT_INCOMPLETE);
    expect(firstConflictOf(validation)).toEqual({ cellX: 20, cellY: 20 });
  });
});

describe('felling by area (GDD sections 131 and 135)', () => {
  const grid = makeGrid({ terrain: TerrainType.FOREST });
  grid.fill(
    { cellX: 0, cellY: 0 },
    { cellX: 3, cellY: 0 },
    {
      ownerPlayerId: VIEWER,
      landUse: LandUse.FOREST_PLOT,
      forestPlotId: 'plot-1',
      hasStandingTree: true,
    },
  );
  grid.set({ cellX: 3, cellY: 0 }, { hasStandingTree: false });
  grid.fill(
    { cellX: 0, cellY: 1 },
    { cellX: 1, cellY: 1 },
    {
      ownerPlayerId: VIEWER,
      landUse: LandUse.FOREST_PLOT,
      forestPlotId: 'plot-2',
      hasStandingTree: true,
    },
  );

  it('accepts cells of the target plot that carry standing trees', () => {
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.FELL_AREA, forestPlotId: 'plot-1' },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 2, cellY: 0 })),
    });
    expect(validation.ok).toBe(true);
  });

  it('tolerates an empty cell of the plot, which felling simply skips', () => {
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.FELL_AREA, forestPlotId: 'plot-1' },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 3, cellY: 0 })),
    });
    expect(validation.ok).toBe(true);
  });

  it('refuses a selection with no standing tree in it', () => {
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.FELL_AREA, forestPlotId: 'plot-1' },
      cells: resolve(grid, [{ cellX: 3, cellY: 0 }]),
    });
    expect(codes(validation)).toContain(ValidationCode.NO_FELLABLE_TREES);
  });

  it('refuses cells of another plot', () => {
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.FELL_AREA, forestPlotId: 'plot-1' },
      cells: resolve(grid, [
        { cellX: 0, cellY: 0 },
        { cellX: 0, cellY: 1 },
      ]),
    });
    expect(codes(validation)).toContain(ValidationCode.TARGET_KIND_MISMATCH);
  });
});

describe('clearing (GDD section 10)', () => {
  it('refuses a cell that still carries a standing tree', () => {
    const grid = makeGrid({ terrain: TerrainType.FOREST });
    grid.fill(
      { cellX: 0, cellY: 0 },
      { cellX: 1, cellY: 0 },
      { ownerPlayerId: VIEWER, landUse: LandUse.FOREST_PLOT, forestPlotId: 'plot-1' },
    );
    grid.set({ cellX: 1, cellY: 0 }, { hasStandingTree: true });
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.CLEAR_LAND, forestPlotId: 'plot-1' },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 1, cellY: 0 })),
    });
    expect(codes(validation)).toContain(ValidationCode.CELL_HAS_STANDING_TREE);
  });
});

describe('building placement (GDD sections 24 and 116)', () => {
  it('accepts a footprint of exactly the size of the catalogue', () => {
    const grid = makeGrid();
    const definition = BUILDING_CATALOGUE.GARAGE;
    grid.fill(
      { cellX: 0, cellY: 0 },
      { cellX: definition.widthCells - 1, cellY: definition.heightCells - 1 },
      { ownerPlayerId: VIEWER, landUse: LandUse.OWNED },
    );
    const cells = rectCells(
      { cellX: 0, cellY: 0 },
      { cellX: definition.widthCells - 1, cellY: definition.heightCells - 1 },
    );
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.BUILDING, buildingType: 'GARAGE' },
      cells: resolve(grid, cells),
    });
    expect(validation.cellCount).toBe(definition.footprintCells);
    expect(validation.ok).toBe(true);
  });

  it('refuses a footprint of the wrong size', () => {
    const grid = makeGrid();
    grid.fill(
      { cellX: 0, cellY: 0 },
      { cellX: 3, cellY: 3 },
      { ownerPlayerId: VIEWER, landUse: LandUse.OWNED },
    );
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.BUILDING, buildingType: 'GARAGE' },
      cells: resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 3, cellY: 3 })),
    });
    expect(codes(validation)).toContain(ValidationCode.VALIDATION_FAILED);
  });
});

describe('cellRuleOf', () => {
  it('agrees with the aggregate about which cells are invalid', () => {
    const grid = makeGrid();
    grid.fill({ cellX: 0, cellY: 0 }, { cellX: 1, cellY: 0 }, { ownerPlayerId: STRANGER });
    const cells = resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 4, cellY: 0 }));
    const rule = cellRuleOf({ mode: SelectionToolMode.PURCHASE });
    const invalid = cells.filter((cell) => rule(cell) !== null);
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.PURCHASE },
      cells,
    });
    expect(invalid).toHaveLength(cells.length - validation.validCellCount);
  });
});

describe('the shared ceiling in the verdict', () => {
  it('reports SELECTION_TOO_LARGE with the same figure the drag stops at', () => {
    const grid = makeGrid();
    const cells = resolve(grid, rectCells({ cellX: 0, cellY: 0 }, { cellX: 4, cellY: 4 }));
    const validation = validateToolSelection({
      intent: { mode: SelectionToolMode.PURCHASE },
      cells,
      // The ceiling comes from the shared configuration and is lowered here, never
      // redefined, which is the point of injecting it (plan section 8).
      config: { ...DEFAULT_SELECTION_CONFIG, maxSelectionCells: 10 },
    });
    expect(codes(validation)).toContain(ValidationCode.SELECTION_TOO_LARGE);
  });
});
