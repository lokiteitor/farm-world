// Contiguity: the client verdict against the rules module, over five hundred shapes.
//
// Owner: workflow W4-G.
//
// GDD section 17 requires the cells of a field to form one contiguous surface, and plan
// section 8 requires the green highlight of the client and the 400 of the server to come
// from the same function. The tool does not implement contiguity: it calls
// `isContiguous` of shared/rules/geometry.ts through `validateSelection`. This suite
// proves that the composition around that call does not lose the property, by comparing
// three answers over the same five hundred random shapes:
//
//   1. A breadth first search written here from scratch, over string keys and with no
//      ceiling, which shares no code with the shared module.
//   2. `isContiguous` of the shared rules.
//   3. The verdict the tool produces, that is whether `validateToolSelection` reports
//      `SELECTION_NOT_CONTIGUOUS` for a field creation.
//
// The shapes are generated from a fixed seed with the deterministic generator of the
// fixtures, so a failure is reproducible from the seed and not from a lucky run. They are
// deliberately awkward: unions of up to five rectangles, holes carved out of them, and
// isolated cells placed apart, which is exactly what the union, subtraction and toggle of
// GDD section 17 let a player draw.

import { describe, expect, it } from 'vitest';
import { resolveCells } from '../cells';
import { SelectionToolMode } from '../modes';
import { validateToolSelection } from '../rules';
import { EMPTY_CELL_SET, subtractRect, toggleCell, unionRect } from '../set';
import { createRng, makeGrid, VIEWER } from './fixtures';
import {
  CHUNK_SIZE,
  LandUse,
  ValidationCode,
  cellFromKey,
  cellKey,
  isContiguous,
  type CellCoordWire,
} from '~/shared/index';

/**
 * Contiguity by breadth first search over string keys.
 *
 * Written from scratch on purpose: sharing the integer key of `shared/rules/geometry.ts`
 * would make the comparison partly circular, and the whole point is that two independent
 * implementations agree.
 */
function referenceContiguous(cells: readonly CellCoordWire[]): boolean {
  if (cells.length === 0) {
    return false;
  }
  const members = new Set(cells.map((cell) => `${cell.cellX}|${cell.cellY}`));
  const first = cells[0];
  if (first === undefined) {
    return false;
  }
  const seen = new Set<string>([`${first.cellX}|${first.cellY}`]);
  const queue: CellCoordWire[] = [first];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === undefined) {
      continue;
    }
    const neighbours: CellCoordWire[] = [
      { cellX: current.cellX, cellY: current.cellY - 1 },
      { cellX: current.cellX + 1, cellY: current.cellY },
      { cellX: current.cellX, cellY: current.cellY + 1 },
      { cellX: current.cellX - 1, cellY: current.cellY },
    ];
    for (const neighbour of neighbours) {
      const key = `${neighbour.cellX}|${neighbour.cellY}`;
      if (members.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(neighbour);
      }
    }
  }
  return seen.size === members.size;
}

/** A random shape inside one chunk: rectangles, a hole and a scattered cell or two. */
function randomShape(next: () => number): readonly CellCoordWire[] {
  const span = CHUNK_SIZE - 1;
  const pick = (): number => next() % span;
  let set = EMPTY_CELL_SET;
  const rectangles = 1 + (next() % 5);
  for (let index = 0; index < rectangles; index += 1) {
    const fromX = pick();
    const fromY = pick();
    const toX = Math.min(span, fromX + (next() % 8));
    const toY = Math.min(span, fromY + (next() % 8));
    set = unionRect(set, { from: { cellX: fromX, cellY: fromY }, to: { cellX: toX, cellY: toY } });
  }
  if (next() % 3 === 0) {
    const holeX = pick();
    const holeY = pick();
    set = subtractRect(set, {
      from: { cellX: holeX, cellY: holeY },
      to: {
        cellX: Math.min(span, holeX + (next() % 3)),
        cellY: Math.min(span, holeY + (next() % 3)),
      },
    });
  }
  if (next() % 4 === 0) {
    set = toggleCell(set, { cellX: pick(), cellY: pick() });
  }
  return set.keys.map((key) => {
    const cell = cellFromKey(key);
    return { cellX: cell.cellX, cellY: cell.cellY };
  });
}

describe('contiguity of the client and of the rules module', () => {
  it('agree on five hundred random shapes, seed 20260812', () => {
    const grid = makeGrid();
    // Every cell of the chunk belongs to the viewer and carries no use, so the only rule
    // a shape can fail is contiguity and the comparison is about that and nothing else.
    grid.fill(
      { cellX: 0, cellY: 0 },
      { cellX: CHUNK_SIZE - 1, cellY: CHUNK_SIZE - 1 },
      { ownerPlayerId: VIEWER, landUse: LandUse.OWNED },
    );

    const next = createRng(20_260_812);
    let contiguousShapes = 0;
    let brokenShapes = 0;

    for (let shape = 0; shape < 500; shape += 1) {
      const cells = randomShape(next);
      if (cells.length === 0) {
        continue;
      }
      const reference = referenceContiguous(cells);
      expect(isContiguous(cells)).toBe(reference);

      const resolution = resolveCells(
        grid.reader,
        cells.map((cell) => cellKey(cell.cellX, cell.cellY)),
      );
      expect(resolution.unresolved).toHaveLength(0);
      const validation = validateToolSelection({
        intent: { mode: SelectionToolMode.FIELD_CREATE },
        cells: resolution.cells,
      });
      const reported = validation.issues.some(
        (issue) => issue.code === ValidationCode.SELECTION_NOT_CONTIGUOUS,
      );
      expect(reported).toBe(!reference);
      if (reference) {
        contiguousShapes += 1;
        expect(validation.ok).toBe(true);
      } else {
        brokenShapes += 1;
      }
    }

    // Both branches have to be exercised, or the suite would pass with a rule that always
    // answered the same thing.
    expect(contiguousShapes).toBeGreaterThan(20);
    expect(brokenShapes).toBeGreaterThan(20);
  });
});
