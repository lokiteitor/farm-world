// The draw plan of the highlight: what the single `Graphics` has to paint.
//
// Owner: workflow W4-G (selection tool). Pure: cells in, rectangles and segments out, so
// the part that decides what is painted is a test and not a screenshot.
//
// Plan section 9.5 asks for one `Graphics`, redrawn only when the selection changes, with
// a valid fill, an invalid fill and the outline of the whole set. Three decisions make
// that affordable at the ceiling of two thousand cells:
//
//   1. Horizontal runs are merged. Two thousand cells drawn one by one are two thousand
//      `fillRect` calls per redraw; merged into runs, a rectangular drag of fifty by
//      forty is forty. The merge is exact and never approximate: a run is a maximal
//      sequence of cells of the same verdict on the same row.
//   2. The outline is `borderSegments` of shared/rules/geometry.ts, the very same
//      extraction the world renderer uses for the outline of a field (NOTES-w4d, section
//      3). A second edge walker here is how the highlight of a selection and the outline
//      of the field it becomes end up one pixel apart.
//   3. The unresolved cells are their own layer. A cell whose chunk has not arrived is
//      not invalid, it is unknown, and painting it red would claim something the client
//      is not entitled to claim (plan section 7).
//
// Everything is in cells. The multiplication by the cell size in pixels happens once, in
// the writer, so a test states a fact about cells and not about a zoom level.

import { type ToolCell } from './cells';
import { type ToolCellRule } from './rules';
import { borderSegments, cellFromKey, type CellCoordWire, type EdgeSegment } from '~/shared/index';

/** A horizontal run of cells of one verdict, in cells. */
export interface CellRun {
  readonly cellX: number;
  readonly cellY: number;
  readonly widthCells: number;
}

export interface SelectionDrawPlan {
  /** Cells that pass their per cell rule. */
  readonly valid: readonly CellRun[];
  /** Cells that fail it. */
  readonly invalid: readonly CellRun[];
  /** Cells whose chunk is not loaded, and about which nothing is known yet. */
  readonly unresolved: readonly CellRun[];
  /** Outline of the whole set, resolved and unresolved alike. */
  readonly outline: readonly EdgeSegment[];
  readonly validCellCount: number;
  readonly invalidCellCount: number;
}

export const EMPTY_DRAW_PLAN: SelectionDrawPlan = {
  valid: [],
  invalid: [],
  unresolved: [],
  outline: [],
  validCellCount: 0,
  invalidCellCount: 0,
};

/**
 * Maximal horizontal runs of a set of cells.
 *
 * Sorted by row and then by column first, because a run is only recognisable in that
 * order and the input arrives in the order the player drew, which is not it.
 */
export function mergeRuns(cells: readonly CellCoordWire[]): readonly CellRun[] {
  if (cells.length === 0) {
    return [];
  }
  const sorted = [...cells].sort((left, right) =>
    left.cellY === right.cellY ? left.cellX - right.cellX : left.cellY - right.cellY,
  );
  const runs: CellRun[] = [];
  let start = sorted[0];
  if (start === undefined) {
    return [];
  }
  let width = 1;
  let previousX = start.cellX;
  for (let index = 1; index < sorted.length; index += 1) {
    const cell = sorted[index];
    if (cell === undefined) {
      continue;
    }
    if (cell.cellY === start.cellY && cell.cellX === previousX + 1) {
      width += 1;
      previousX = cell.cellX;
      continue;
    }
    if (cell.cellY === start.cellY && cell.cellX === previousX) {
      // A duplicate cannot reach here from a `CellSet`, whose keys are unique, but the
      // function is public and a duplicate must not open a hole in the run.
      continue;
    }
    runs.push({ cellX: start.cellX, cellY: start.cellY, widthCells: width });
    start = cell;
    width = 1;
    previousX = cell.cellX;
  }
  runs.push({ cellX: start.cellX, cellY: start.cellY, widthCells: width });
  return runs;
}

export interface DrawPlanInput {
  /** Cells that resolved against the chunk cache, in the order the player drew them. */
  readonly cells: readonly ToolCell[];
  /** Keys of the cells whose chunk is not loaded. */
  readonly unresolved: readonly number[];
  /** The per cell rule of the current mode. */
  readonly rule: ToolCellRule;
}

/** What the highlight has to paint for the current selection. */
export function selectionDrawPlan(input: DrawPlanInput): SelectionDrawPlan {
  const valid: CellCoordWire[] = [];
  const invalid: CellCoordWire[] = [];
  const all: CellCoordWire[] = [];
  for (const cell of input.cells) {
    const coord = { cellX: cell.cellX, cellY: cell.cellY };
    all.push(coord);
    if (input.rule(cell) === null) {
      valid.push(coord);
    } else {
      invalid.push(coord);
    }
  }
  const unresolved: CellCoordWire[] = [];
  for (const key of input.unresolved) {
    const cell = cellFromKey(key);
    const coord = { cellX: cell.cellX, cellY: cell.cellY };
    unresolved.push(coord);
    all.push(coord);
  }
  return {
    valid: mergeRuns(valid),
    invalid: mergeRuns(invalid),
    unresolved: mergeRuns(unresolved),
    outline: borderSegments(all),
    validCellCount: valid.length,
    invalidCellCount: invalid.length,
  };
}
