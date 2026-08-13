// The draw plan: run merging, the three layers and the shared border extraction.
//
// Owner: workflow W4-G. What matters here is that the plan covers exactly the cells of
// the set, that the outline is the one `shared/rules/geometry.ts` produces, and that an
// unresolved cell is neither valid nor invalid.

import { describe, expect, it } from 'vitest';
import { resolveCells } from '../cells';
import { mergeRuns, selectionDrawPlan } from '../draw';
import { SelectionToolMode } from '../modes';
import { cellRuleOf } from '../rules';
import { makeGrid, rectCells, STRANGER } from './fixtures';
import { borderSegments, cellKey, type CellCoordWire } from '~/shared/index';

function areaOf(runs: readonly { readonly widthCells: number }[]): number {
  return runs.reduce((total, run) => total + run.widthCells, 0);
}

describe('mergeRuns', () => {
  it('merges a row into one run', () => {
    const cells = rectCells({ cellX: 4, cellY: 2 }, { cellX: 8, cellY: 2 });
    expect(mergeRuns(cells)).toEqual([{ cellX: 4, cellY: 2, widthCells: 5 }]);
  });

  it('splits a row at a hole', () => {
    const cells: CellCoordWire[] = [
      { cellX: 0, cellY: 0 },
      { cellX: 1, cellY: 0 },
      { cellX: 3, cellY: 0 },
    ];
    expect(mergeRuns(cells)).toEqual([
      { cellX: 0, cellY: 0, widthCells: 2 },
      { cellX: 3, cellY: 0, widthCells: 1 },
    ]);
  });

  it('does not merge across rows', () => {
    const cells: CellCoordWire[] = [
      { cellX: 0, cellY: 0 },
      { cellX: 0, cellY: 1 },
    ];
    expect(mergeRuns(cells)).toHaveLength(2);
  });

  it('sorts an input given in the order the player drew it', () => {
    const cells: CellCoordWire[] = [
      { cellX: 2, cellY: 0 },
      { cellX: 0, cellY: 0 },
      { cellX: 1, cellY: 0 },
    ];
    expect(mergeRuns(cells)).toEqual([{ cellX: 0, cellY: 0, widthCells: 3 }]);
  });

  it('turns a fifty by forty rectangle into forty runs and not two thousand', () => {
    const cells = rectCells({ cellX: 0, cellY: 0 }, { cellX: 49, cellY: 39 });
    const runs = mergeRuns(cells);
    expect(runs).toHaveLength(40);
    expect(areaOf(runs)).toBe(2000);
  });

  it('answers nothing for an empty set', () => {
    expect(mergeRuns([])).toEqual([]);
  });
});

describe('selectionDrawPlan', () => {
  it('splits the set into the cells that pass their rule and the ones that do not', () => {
    const grid = makeGrid();
    grid.fill({ cellX: 0, cellY: 0 }, { cellX: 1, cellY: 0 }, { ownerPlayerId: STRANGER });
    const cells = rectCells({ cellX: 0, cellY: 0 }, { cellX: 4, cellY: 0 });
    const resolution = resolveCells(
      grid.reader,
      cells.map((cell) => cellKey(cell.cellX, cell.cellY)),
    );
    const plan = selectionDrawPlan({
      cells: resolution.cells,
      unresolved: resolution.unresolved,
      rule: cellRuleOf({ mode: SelectionToolMode.PURCHASE }),
    });
    expect(plan.invalidCellCount).toBe(2);
    expect(plan.validCellCount).toBe(3);
    expect(areaOf(plan.valid) + areaOf(plan.invalid)).toBe(5);
  });

  it('keeps an unresolved cell out of both verdicts and still outlines it', () => {
    const grid = makeGrid({ loadedChunks: [{ chunkX: 0, chunkY: 0 }] });
    const inside = { cellX: 1, cellY: 1 };
    // A cell of a chunk that has not arrived: unknown, and not invalid (plan section 7).
    const outside = { cellX: 40, cellY: 1 };
    const resolution = resolveCells(grid.reader, [
      cellKey(inside.cellX, inside.cellY),
      cellKey(outside.cellX, outside.cellY),
    ]);
    const plan = selectionDrawPlan({
      cells: resolution.cells,
      unresolved: resolution.unresolved,
      rule: cellRuleOf({ mode: SelectionToolMode.PURCHASE }),
    });
    expect(plan.unresolved).toEqual([{ cellX: 40, cellY: 1, widthCells: 1 }]);
    expect(plan.validCellCount).toBe(1);
    expect(plan.invalidCellCount).toBe(0);
    expect(plan.outline).toHaveLength(8);
  });

  it('outlines the whole set with the same extraction the world renderer uses', () => {
    const grid = makeGrid();
    const cells = rectCells({ cellX: 2, cellY: 2 }, { cellX: 4, cellY: 4 });
    const resolution = resolveCells(
      grid.reader,
      cells.map((cell) => cellKey(cell.cellX, cell.cellY)),
    );
    const plan = selectionDrawPlan({
      cells: resolution.cells,
      unresolved: [],
      rule: cellRuleOf({ mode: SelectionToolMode.PURCHASE }),
    });
    expect(plan.outline).toEqual(borderSegments(cells));
    // A three by three square has twelve edges on its perimeter.
    expect(plan.outline).toHaveLength(12);
  });

  it('is empty for an empty selection', () => {
    const plan = selectionDrawPlan({
      cells: [],
      unresolved: [],
      rule: cellRuleOf({ mode: SelectionToolMode.PURCHASE }),
    });
    expect(plan.outline).toEqual([]);
    expect(plan.valid).toEqual([]);
  });
});
