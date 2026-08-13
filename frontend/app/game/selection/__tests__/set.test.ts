// Set algebra of the selection: union, subtraction, toggling and the shared ceiling.
//
// Owner: workflow W4-G. These four operations are what GDD section 17 turns into
// "arbitrary shapes without a freehand tool" (plan section 9.5), so they are asserted as
// algebra and not as behaviour of the tool: order preserved, idempotence of a repeated
// union, subtraction as the inverse of union over the same rectangle, and the ceiling
// applied while the rectangle is walked rather than after it.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_CELL_SET,
  cellsOf,
  rectCellCount,
  replaceCells,
  replaceWithRect,
  sameCells,
  subtractRect,
  toggleCell,
  unionRect,
} from '../set';
import { MAX_SELECTION_CELLS, cellKey } from '~/shared/index';

const corner = (cellX: number, cellY: number): { cellX: number; cellY: number } => ({
  cellX,
  cellY,
});

describe('rectCellCount', () => {
  it('counts a rectangle whichever way round its corners are given', () => {
    expect(rectCellCount({ from: corner(0, 0), to: corner(4, 2) })).toBe(15);
    expect(rectCellCount({ from: corner(4, 2), to: corner(0, 0) })).toBe(15);
    expect(rectCellCount({ from: corner(-3, -3), to: corner(-3, -3) })).toBe(1);
  });
});

describe('unionRect', () => {
  it('adds every cell of the rectangle in row major order', () => {
    const set = unionRect(EMPTY_CELL_SET, { from: corner(2, 5), to: corner(4, 6) });
    expect(cellsOf(set)).toEqual([
      corner(2, 5),
      corner(3, 5),
      corner(4, 5),
      corner(2, 6),
      corner(3, 6),
      corner(4, 6),
    ]);
    expect(set.capped).toBe(false);
  });

  it('is idempotent and keeps the order of the first insertion', () => {
    const once = unionRect(EMPTY_CELL_SET, { from: corner(0, 0), to: corner(2, 2) });
    const twice = unionRect(once, { from: corner(0, 0), to: corner(2, 2) });
    expect(sameCells(once, twice)).toBe(true);
  });

  it('appends the new cells of an overlapping rectangle after the ones it had', () => {
    const first = unionRect(EMPTY_CELL_SET, { from: corner(0, 0), to: corner(1, 0) });
    const second = unionRect(first, { from: corner(1, 0), to: corner(2, 0) });
    expect(cellsOf(second)).toEqual([corner(0, 0), corner(1, 0), corner(2, 0)]);
  });

  it('works across the origin, where a truncating modulus would misplace a cell', () => {
    const set = unionRect(EMPTY_CELL_SET, { from: corner(-1, -1), to: corner(0, 0) });
    expect(set.keys).toHaveLength(4);
    expect(set.keys).toContain(cellKey(-1, -1));
    expect(set.keys).toContain(cellKey(0, 0));
  });
});

describe('subtractRect', () => {
  it('is the inverse of a union over the same rectangle', () => {
    const base = unionRect(EMPTY_CELL_SET, { from: corner(0, 0), to: corner(5, 5) });
    const grown = unionRect(base, { from: corner(6, 0), to: corner(7, 5) });
    const back = subtractRect(grown, { from: corner(6, 0), to: corner(7, 5) });
    expect(sameCells(back, base)).toBe(true);
  });

  it('carves a hole, which is the shape a single rectangle cannot express', () => {
    const base = unionRect(EMPTY_CELL_SET, { from: corner(0, 0), to: corner(4, 4) });
    const holed = subtractRect(base, { from: corner(2, 2), to: corner(2, 2) });
    expect(holed.keys).toHaveLength(24);
    expect(holed.keys).not.toContain(cellKey(2, 2));
  });

  it('ignores a rectangle that touches nothing', () => {
    const base = unionRect(EMPTY_CELL_SET, { from: corner(0, 0), to: corner(1, 1) });
    expect(sameCells(subtractRect(base, { from: corner(9, 9), to: corner(9, 9) }), base)).toBe(
      true,
    );
  });
});

describe('toggleCell', () => {
  it('adds an absent cell and removes a present one', () => {
    const added = toggleCell(EMPTY_CELL_SET, corner(3, 3));
    expect(cellsOf(added)).toEqual([corner(3, 3)]);
    expect(cellsOf(toggleCell(added, corner(3, 3)))).toEqual([]);
  });

  it('refuses to add past the ceiling and says so', () => {
    const full = replaceWithRect({ from: corner(0, 0), to: corner(1, 0) }, 2);
    const attempt = toggleCell(full, corner(5, 5), 2);
    expect(attempt.keys).toHaveLength(2);
    expect(attempt.capped).toBe(true);
  });

  it('still removes when the set is at the ceiling', () => {
    const full = replaceWithRect({ from: corner(0, 0), to: corner(1, 0) }, 2);
    const removed = toggleCell(full, corner(0, 0), 2);
    expect(cellsOf(removed)).toEqual([corner(1, 0)]);
    expect(removed.capped).toBe(false);
  });
});

describe('the shared ceiling', () => {
  it('stops a drag from growing and reports it, instead of building the whole rectangle', () => {
    // Fifty by fifty is two thousand five hundred cells, past MAX_SELECTION_CELLS.
    const set = unionRect(EMPTY_CELL_SET, { from: corner(0, 0), to: corner(49, 49) });
    expect(rectCellCount({ from: corner(0, 0), to: corner(49, 49) })).toBe(2500);
    expect(set.keys).toHaveLength(MAX_SELECTION_CELLS);
    expect(set.capped).toBe(true);
  });

  it('is the same figure the server validates with', () => {
    // Not a tautology: it asserts that this module takes the ceiling from the shared
    // catalogue and does not keep a second copy of the number (ADR-0012).
    expect(MAX_SELECTION_CELLS).toBe(2000);
    const set = replaceWithRect({ from: corner(0, 0), to: corner(99, 99) });
    expect(set.keys).toHaveLength(MAX_SELECTION_CELLS);
  });

  it('applies to a replacement of the whole set as well', () => {
    const cells = Array.from({ length: 10 }, (_unused, index) => corner(index, 0));
    const set = replaceCells(cells, 4);
    expect(set.keys).toHaveLength(4);
    expect(set.capped).toBe(true);
  });

  it('drops duplicates of a replacement without counting them twice', () => {
    const set = replaceCells([corner(1, 1), corner(1, 1), corner(2, 1)]);
    expect(cellsOf(set)).toEqual([corner(1, 1), corner(2, 1)]);
  });
});
